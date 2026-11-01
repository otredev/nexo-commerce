import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { docNumber, type Paginated, type PurchaseOrderListItem, type Supplier } from "@nexo/shared";
import { Alert, Button, EmptyState, PageHeader, Pagination, Progress, SearchInput, Segmented, useDebounced } from "@nexo/ui";
import { get } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad } from "../../lib/hooks";
import { dateFmt, formatDay, PurchaseStatusBadge } from "../../components/docs";

type Filter = "open" | "all" | "received" | "cancelled";

export function PurchasesPage() {
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDebounced(q);
  const status = (params.get("estado") ?? "open") as Filter;
  const supplierId = params.get("proveedor") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: true });
  };
  const search = new URLSearchParams({ status, page: String(page), ...(query && { q: query }), ...(supplierId && { supplierId }) });
  const { data, error, loading } = useLoad(() => get<Paginated<PurchaseOrderListItem>>(`/purchases?${search}`), [search.toString()]);
  const suppliers = useLoad(() => get<Supplier[]>("/suppliers?status=all"));
  const filtered = Boolean(query || supplierId || status !== "open");

  return (
    <>
      <PageHeader
        title="Compras"
        description="Órdenes a proveedores y lo que ya llegó."
        actions={can("purchases:write") && <Button variant="primary" onClick={() => navigate("/compras/nueva")}>Nueva orden</Button>}
      />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput label="Buscar orden" placeholder="Folio o proveedor" value={q} onChange={(v) => { setQ(v); set("q", v); }} />
          <div className="nx-filters">
            <select className="nx-select" aria-label="Proveedor" value={supplierId} onChange={(e) => set("proveedor", e.target.value)}>
              <option value="">Todos los proveedores</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Segmented
              label="Estado"
              value={status}
              onChange={(v) => set("estado", v === "open" ? "" : v)}
              options={[{ id: "open", label: "Abiertas" }, { id: "received", label: "Recibidas" }, { id: "cancelled", label: "Canceladas" }, { id: "all", label: "Todas" }]}
            />
          </div>
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="nx-icon" />}
            title={filtered ? "Ninguna orden coincide" : "No hay órdenes abiertas"}
            text={filtered ? undefined : "Crea una orden para pedir mercancía a un proveedor. Al recibirla, las existencias y el costo promedio se actualizan solos."}
            actions={filtered ? <Button variant="ghost" onClick={() => { setQ(""); setParams({}); }}>Ver órdenes abiertas</Button> : can("purchases:write") && <Button variant="primary" onClick={() => navigate("/compras/nueva")}>Nueva orden</Button>}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead>
                <tr><th>Folio</th><th>Proveedor</th><th>Estado</th><th>Recibido</th><th>Entrega</th><th className="nx-col-num">Total</th><th>Creada</th></tr>
              </thead>
              <tbody>
                {data?.items.map((o) => (
                  <tr key={o.id} className="nx-clickable" onClick={() => navigate(`/compras/${o.id}`)}>
                    <td className="nx-mono" style={{ whiteSpace: "nowrap" }}>{docNumber("purchase", o.number)}</td>
                    <td>{o.supplierName}<div className="nx-muted" style={{ fontSize: 12 }}>{o.itemsCount} {o.itemsCount === 1 ? "producto" : "productos"} · {o.locationName}</div></td>
                    <td><PurchaseStatusBadge status={o.status} /></td>
                    <td>
                      {o.status === "draft" || o.status === "cancelled" ? <span className="nx-muted">—</span> : (
                        <div className="nx-progress-cell"><Progress value={o.progress} label={`Recibido de ${docNumber("purchase", o.number)}`} /><span className="nx-num nx-muted" style={{ fontSize: 12 }}>{Math.round(o.progress * 100)} %</span></div>
                      )}
                    </td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{formatDay(o.expectedDate)}</td>
                    <td className="nx-col-num" style={{ fontWeight: 500 }}>{money(o.totalCents)}</td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{dateFmt.format(new Date(o.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="órdenes" onPage={(p) => set("pagina", String(p))} />}
      </div>
    </>
  );
}
