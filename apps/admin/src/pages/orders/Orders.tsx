import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Globe, ShoppingBag, Store, Truck } from "lucide-react";
import { type OrderListItem, type Paginated, type StoreSettings } from "@nexo/shared";
import { Alert, Button, EmptyState, PageHeader, Pagination, SearchInput, Segmented, useDebounced } from "@nexo/ui";
import { get } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad } from "../../lib/hooks";
import { ago, OrderStatusBadge, orderLabel, PaymentBadge } from "../../components/orders";

type Filter = "open" | "pending" | "completed" | "cancelled" | "all";

export function OrdersPage() {
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDebounced(q);
  const status = (params.get("estado") ?? "open") as Filter;
  const page = Number(params.get("pagina") ?? 1) || 1;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: true });
  };
  const search = new URLSearchParams({ status, page: String(page), ...(query && { q: query }) });
  const { data, error, loading } = useLoad(() => get<Paginated<OrderListItem>>(`/orders?${search}`), [search.toString()]);
  const store = useLoad(() => get<StoreSettings>("/store-settings"));
  const filtered = Boolean(query) || status !== "open";

  return (
    <>
      <PageHeader
        title="Pedidos en línea"
        description="Lo que tus clientes compran en tu tienda. Las existencias se apartan al recibir cada pedido."
        actions={store.data?.enabled && <Button onClick={() => window.open(store.data!.url, "_blank", "noopener")}><Globe className="nx-icon" aria-hidden="true" />Ver mi tienda</Button>}
      />
      {store.data && !store.data.enabled && (
        <Alert tone="info" title="Tu tienda en línea está apagada">
          {can("store:write") ? <>Actívala en <button type="button" className="nx-link" style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => navigate("/tienda")}>Ajustes de la tienda</button> para empezar a recibir pedidos.</> : "Pide a un administrador que la active."}
        </Alert>
      )}
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput label="Buscar pedido" placeholder="Folio, cliente o teléfono" value={q} onChange={(v) => { setQ(v); set("q", v); }} />
          <Segmented
            label="Estado"
            value={status}
            onChange={(v) => set("estado", v === "open" ? "" : v)}
            options={[{ id: "open", label: "Por atender" }, { id: "pending", label: "Nuevos" }, { id: "completed", label: "Entregados" }, { id: "cancelled", label: "Cancelados" }, { id: "all", label: "Todos" }]}
          />
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="nx-icon" />}
            title={filtered ? "Ningún pedido coincide" : "No hay pedidos por atender"}
            text={filtered ? undefined : "Cuando alguien compre en tu tienda, el pedido aparecerá aquí y te llegará un correo."}
            actions={filtered && <Button variant="ghost" onClick={() => { setQ(""); setParams({}); }}>Ver pedidos por atender</Button>}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Estado</th><th>Pago</th><th className="nx-col-num">Total</th></tr></thead>
              <tbody>
                {data?.items.map((o) => (
                  <tr key={o.id} className="nx-clickable" onClick={() => navigate(`/pedidos/${o.id}`)} style={o.status === "pending" ? { fontWeight: 500 } : undefined}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className="nx-mono">{orderLabel(o.number)}</span>
                      <div className="nx-muted" style={{ fontSize: 12, fontWeight: 400 }}>{ago(o.createdAt)}</div>
                    </td>
                    <td>{o.customerName}<div className="nx-muted" style={{ fontSize: 12, fontWeight: 400 }}>{o.customerPhone}</div></td>
                    <td className="nx-muted" style={{ fontWeight: 400 }}>
                      <span className="nx-row" style={{ gap: 6 }}>{o.fulfillment === "pickup" ? <Store size={14} aria-hidden="true" /> : <Truck size={14} aria-hidden="true" />}{o.fulfillment === "pickup" ? "Recoge" : "Envío"}</span>
                    </td>
                    <td><OrderStatusBadge status={o.status} fulfillment={o.fulfillment} /></td>
                    <td><PaymentBadge status={o.paymentStatus} /></td>
                    <td className="nx-col-num">{money(o.totalCents)}<div className="nx-muted" style={{ fontSize: 12, fontWeight: 400 }}>{o.itemsCount} {o.itemsCount === 1 ? "producto" : "productos"}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="pedidos" onPage={(p) => set("pagina", String(p))} />}
      </div>
    </>
  );
}
