import { Link, useSearchParams } from "react-router-dom";
import { ScrollText } from "lucide-react";
import { PLATFORM_ACTION_LABELS, type PlatformAuditEntry, type PlatformOperator } from "@nexo/shared";
import { Alert, EmptyState, PageHeader, Pagination, SelectField } from "@nexo/ui";
import { get } from "../../lib/api";
import { useLoad } from "../../lib/hooks";
import { fmtDateTime } from "../auth";

const ENTITY_LINK: Record<string, (id: string) => string> = {
  tenant: (id) => `/negocios/${id}`,
  user: (id) => `/usuarios/${id}`,
  ticket: (id) => `/soporte/${id}`,
};

/** Entries of the platform log (also used in a business's detail). */
export function AuditList({ items, empty, hideTenant }: { items: PlatformAuditEntry[]; empty: string; hideTenant?: boolean }) {
  if (!items.length) return <p className="nx-muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ol className="nx-log">
      {items.map((e) => {
        const label = PLATFORM_ACTION_LABELS[e.action] ?? e.action;
        const link = e.entityId && ENTITY_LINK[e.entity]?.(e.entityId);
        return (
          <li key={e.id} className="nx-log__item" data-action={e.action}>
            <div className="nx-log__head">
              <span><strong>{e.operatorName}</strong> · {link ? <Link className="nx-link" to={link}>{label}</Link> : label}</span>
              <time className="nx-muted nx-num" dateTime={e.createdAt}>{fmtDateTime(e.createdAt)}</time>
            </div>
            {(e.summary || (!hideTenant && e.tenantName)) && (
              <div className="nx-log__meta nx-muted">
                {!hideTenant && e.tenantName && e.tenantId && <><Link className="nx-link" to={`/negocios/${e.tenantId}`}>{e.tenantName}</Link>{e.summary ? " · " : ""}</>}
                {e.summary}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("pagina") ?? 1) || 1;
  const operatorId = params.get("operador") ?? "";
  const entity = params.get("tipo") ?? "";
  const tenantId = params.get("negocio") ?? "";
  const set = (key: string, value: string) => setParams((p) => { const n = new URLSearchParams(p); if (value) n.set(key, value); else n.delete(key); if (key !== "pagina") n.delete("pagina"); return n; });
  const query = new URLSearchParams({ page: String(page), ...(operatorId && { operatorId }), ...(entity && { entity }), ...(tenantId && { tenantId }) });
  const { data, error, loading } = useLoad(() => get<{ items: PlatformAuditEntry[]; total: number; page: number; pageSize: number }>(`/platform/audit?${query}`), [query.toString()]);
  const ops = useLoad(() => get<{ items: PlatformOperator[] }>("/platform/operators"), []);
  return (
    <>
      <PageHeader title="Bitácora" description="Todo lo que hace el equipo de Nexo: inicios de sesión, suspensiones, planes, accesos a negocios y respuestas de soporte." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SelectField label="Operador" value={operatorId} onChange={(e) => set("operador", e.target.value)} fieldClassName="nx-toolbar-select">
            <option value="">Todos los operadores</option>
            {ops.data?.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </SelectField>
          <SelectField label="Tipo" value={entity} onChange={(e) => set("tipo", e.target.value)} fieldClassName="nx-toolbar-select">
            <option value="">Todo</option>
            <option value="tenant">Negocios</option>
            <option value="user">Usuarios</option>
            <option value="ticket">Soporte</option>
            <option value="operator">Operadores y accesos</option>
          </SelectField>
          {tenantId && <button type="button" className="nx-link" onClick={() => set("negocio", "")}>Quitar filtro de negocio</button>}
        </div>
        <div className="nx-table-pad" aria-busy={loading}>
          {data && data.items.length === 0
            ? <EmptyState icon={<ScrollText className="nx-icon" />} title="Sin movimientos" text="Nada coincide con estos filtros." />
            : data && <AuditList items={data.items} empty="" />}
        </div>
        {data && data.total > data.pageSize && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set("pagina", String(p))} noun="movimientos" />}
      </div>
    </>
  );
}
