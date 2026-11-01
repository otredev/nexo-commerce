import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Receipt } from "lucide-react";
import { formatFolio, paymentLabel, type Paginated, type SaleListItem } from "@nexo/shared";
import { Alert, Badge, Button, EmptyState, PageHeader, Pagination, SearchInput, useDebounced } from "@nexo/ui";
import { get } from "../lib/api";
import { useBusiness } from "../lib/business";
import { useLoad } from "../lib/hooks";

const timeFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

export function SalesPage() {
  const { money, locations } = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDebounced(q);
  const from = params.get("desde") ?? "";
  const to = params.get("hasta") ?? "";
  const status = params.get("estado") ?? "all";
  const locationId = params.get("ubicacion") ?? "";
  const sessionId = params.get("sesion") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: true });
  };
  const search = new URLSearchParams({ status, page: String(page), pageSize: "25", ...(query && { q: query }), ...(from && { from }), ...(to && { to }), ...(locationId && { locationId }), ...(sessionId && { sessionId }) });
  const { data, error, loading } = useLoad(() => get<Paginated<SaleListItem>>(`/sales?${search}`), [search.toString()]);
  const filtered = Boolean(query || from || to || status !== "all" || locationId || sessionId);

  return (
    <>
      <PageHeader title="Ventas" description="Historial de ventas del punto de venta." actions={<Button variant="primary" onClick={() => navigate("/pos")}>Abrir punto de venta</Button>} />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput label="Buscar ventas" placeholder="Folio o cliente" value={q} onChange={(v) => { setQ(v); set("q", v); }} />
          <div className="nx-filters">
            <input className="nx-input" type="date" aria-label="Desde" style={{ height: "var(--control-sm)", width: 150, fontSize: 13 }} value={from} onChange={(e) => set("desde", e.target.value)} />
            <input className="nx-input" type="date" aria-label="Hasta" style={{ height: "var(--control-sm)", width: 150, fontSize: 13 }} value={to} onChange={(e) => set("hasta", e.target.value)} />
            {locations.length > 1 && (
              <select className="nx-select" aria-label="Ubicación" value={locationId} onChange={(e) => set("ubicacion", e.target.value)}>
                <option value="">Todas las ubicaciones</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <select className="nx-select" aria-label="Estado" value={status} onChange={(e) => set("estado", e.target.value === "all" ? "" : e.target.value)}>
              <option value="all">Todas</option>
              <option value="completed">Completadas</option>
              <option value="voided">Anuladas</option>
            </select>
          </div>
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState icon={<Receipt className="nx-icon" />} title={filtered ? "Ninguna venta coincide" : "Aún no hay ventas"} text={filtered ? undefined : "Las ventas del punto de venta aparecerán aquí."} actions={filtered ? <Button variant="ghost" onClick={() => { setQ(""); setParams({}); }}>Limpiar filtros</Button> : undefined} />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Atendió</th><th>Pago</th><th>Estado</th><th className="nx-col-num">Total</th></tr></thead>
              <tbody>
                {data?.items.map((s) => (
                  <tr key={s.id} className="nx-clickable" onClick={() => navigate(`/ventas/${s.id}`)}>
                    <td className="nx-mono">{formatFolio(s.number)}</td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{timeFmt.format(new Date(s.createdAt))}</td>
                    <td>{s.customerName ?? <span className="nx-muted">—</span>}</td>
                    <td className="nx-muted">{s.userName}</td>
                    <td className="nx-muted">{s.methods.map(paymentLabel).join(" + ")}</td>
                    <td>{s.status === "voided" ? <Badge tone="danger">Anulada</Badge> : s.refundedCents > 0 ? <Badge tone="warning">{s.refundedCents >= s.totalCents ? "Devuelta" : "Devolución parcial"}</Badge> : <Badge tone="success">Completada</Badge>}</td>
                    <td className="nx-col-num" style={{ fontWeight: 500, textDecoration: s.status === "voided" ? "line-through" : undefined }}>{money(s.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="ventas" onPage={(p) => set("pagina", String(p))} />}
      </div>
    </>
  );
}
