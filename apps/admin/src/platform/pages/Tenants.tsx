import { useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2 } from "lucide-react";
import { PLANS, type PlatformTenant } from "@nexo/shared";
import { Alert, Badge, EmptyState, PageHeader, SearchInput, Segmented, SelectField, Stat, useDebounced } from "@nexo/ui";
import { get } from "../../lib/api";
import { useLoad } from "../../lib/hooks";
import { fmtDate } from "../auth";

type StatusFilter = "all" | "active" | "suspended";
type PlanFilter = "all" | "free" | "pro" | "business";

export const TENANT_STATUS_BADGE: Record<PlatformTenant["status"], ReactElement> = {
  active: <Badge tone="success">Activo</Badge>,
  suspended: <Badge tone="danger">Suspendido</Badge>,
  migrating: <Badge tone="warning">Moviendo</Badge>,
  provisioning: <Badge plain>Creándose</Badge>,
};

export function TenantsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = (params.get("estado") ?? "all") as StatusFilter;
  const plan = (params.get("plan") ?? "all") as PlanFilter;
  const query = useDebounced(q);
  const set = (key: string, value: string) => setParams((p) => { const n = new URLSearchParams(p); if (value === "all" || !value) n.delete(key); else n.set(key, value); return n; }, { replace: true });
  const search = new URLSearchParams({ status, plan, ...(query.trim() && { q: query.trim() }) });
  const { data, error, loading } = useLoad(
    () => get<{ items: PlatformTenant[]; totals: { total: number; active: number; suspended: number; paying: number } }>(`/platform/tenants?${search}`),
    [search.toString()],
  );
  return (
    <>
      <PageHeader title="Negocios" description="Todos los negocios de la plataforma: plan, propietario, estado y tickets abiertos." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {data && (
        <div className="nx-stat-grid">
          <Stat label="Negocios" value={data.totals.total} />
          <Stat label="Activos" value={data.totals.active} />
          <Stat label="De pago" value={data.totals.paying} />
          <Stat label="Suspendidos" value={data.totals.suspended} />
        </div>
      )}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput value={q} onChange={(v) => { setQ(v); set("q", v); }} placeholder="Nombre, dirección o correo del propietario" label="Buscar negocio" width={320} />
          <Segmented label="Estado" value={status} onChange={(v) => set("estado", v)} options={[{ id: "all", label: "Todos" }, { id: "active", label: "Activos" }, { id: "suspended", label: "Suspendidos" }]} />
          <SelectField label="Plan" value={plan} onChange={(e) => set("plan", e.target.value)} fieldClassName="nx-toolbar-select">
            <option value="all">Todos los planes</option>
            {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState icon={<Building2 className="nx-icon" />} title="Ningún negocio coincide" text="Prueba con otra búsqueda o quita los filtros." />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Negocio</th><th>Propietario</th><th>Plan</th><th>Estado</th><th className="nx-num">Usuarios</th><th className="nx-num">Tickets</th><th>Alta</th></tr></thead>
              <tbody>
                {data?.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link className="nx-link nx-strong" to={`/negocios/${t.id}`}>{t.name}</Link>
                      <div className="nx-muted nx-mono" style={{ fontSize: 12 }}>/{t.slug}{t.domains.length ? ` · ${t.domains.join(", ")}` : ""}</div>
                    </td>
                    <td>{t.owner ? <><div>{t.owner.name}</div><div className="nx-muted" style={{ fontSize: 12 }}>{t.owner.email}</div></> : "—"}</td>
                    <td>{PLANS[t.plan].name}{t.planStatus === "past_due" && <> <Badge tone="warning">Pago pendiente</Badge></>}</td>
                    <td>{TENANT_STATUS_BADGE[t.status]}</td>
                    <td className="nx-num">{t.members}</td>
                    <td className="nx-num">{t.openTickets > 0 ? <Badge tone="info">{t.openTickets}</Badge> : <span className="nx-muted">0</span>}</td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{fmtDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
