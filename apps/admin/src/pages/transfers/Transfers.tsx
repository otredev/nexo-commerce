import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Truck } from "lucide-react";
import { docNumber, type Paginated, type TransferListItem } from "@nexo/shared";
import { Alert, Button, EmptyState, PageHeader, Pagination, Segmented } from "@nexo/ui";
import { get } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad } from "../../lib/hooks";
import { dateTimeFmt, TransferStatusBadge } from "../../components/docs";

type Filter = "open" | "received" | "cancelled" | "all";

export function TransfersPage() {
  const { can } = useAuth();
  const { locations } = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get("estado") ?? "open") as Filter;
  const locationId = params.get("ubicacion") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: true });
  };
  const search = new URLSearchParams({ status, page: String(page), ...(locationId && { locationId }) });
  const { data, error, loading } = useLoad(() => get<Paginated<TransferListItem>>(`/transfers?${search}`), [search.toString()]);
  const active = locations.filter((l) => l.active);
  const filtered = status !== "open" || Boolean(locationId);

  return (
    <>
      <PageHeader
        title="Traspasos"
        description="Mueve mercancía entre tus tiendas y bodegas."
        actions={can("transfers:write") && active.length > 1 && <Button variant="primary" onClick={() => navigate("/traspasos/nuevo")}>Nuevo traspaso</Button>}
      />
      {active.length < 2 && (
        <Alert tone="info" title="Necesitas al menos dos ubicaciones">
          Agrega una bodega u otra tienda en Configuración → Ubicaciones para poder mover mercancía entre ellas.
        </Alert>
      )}
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <div className="nx-filters">
            <select className="nx-select" aria-label="Ubicación" value={locationId} onChange={(e) => set("ubicacion", e.target.value)}>
              <option value="">Todas las ubicaciones</option>
              {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <Segmented
            label="Estado"
            value={status}
            onChange={(v) => set("estado", v === "open" ? "" : v)}
            options={[{ id: "open", label: "Pendientes" }, { id: "received", label: "Recibidos" }, { id: "cancelled", label: "Cancelados" }, { id: "all", label: "Todos" }]}
          />
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<Truck className="nx-icon" />}
            title={filtered ? "Ningún traspaso coincide" : "No hay traspasos pendientes"}
            text={filtered ? undefined : "Un traspaso descuenta del origen al enviarse y suma al destino cuando alguien confirma lo que llegó."}
            actions={filtered ? <Button variant="ghost" onClick={() => setParams({})}>Ver pendientes</Button> : can("transfers:write") && active.length > 1 && <Button variant="primary" onClick={() => navigate("/traspasos/nuevo")}>Nuevo traspaso</Button>}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Folio</th><th>Ruta</th><th>Estado</th><th className="nx-col-num">Productos</th><th>Última actualización</th></tr></thead>
              <tbody>
                {data?.items.map((t) => (
                  <tr key={t.id} className="nx-clickable" onClick={() => navigate(`/traspasos/${t.id}`)}>
                    <td className="nx-mono">{docNumber("transfer", t.number)}</td>
                    <td><span className="nx-row" style={{ gap: 6 }}>{t.fromLocationName}<ArrowRight size={14} className="nx-muted" aria-label="a" />{t.toLocationName}</span></td>
                    <td><TransferStatusBadge status={t.status} /></td>
                    <td className="nx-col-num">{t.itemsCount}</td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>
                      {dateTimeFmt.format(new Date(t.receivedAt ?? t.sentAt ?? t.createdAt))}
                      <span style={{ marginLeft: 6 }}>{t.receivedAt ? "recibido" : t.sentAt ? "enviado" : `creado por ${t.createdByName ?? "—"}`}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="traspasos" onPage={(p) => set("pagina", String(p))} />}
      </div>
    </>
  );
}
