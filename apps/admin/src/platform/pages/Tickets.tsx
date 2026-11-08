import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { TICKET_CATEGORY_LABELS, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS_OPERATOR, type SupportTicket, type TicketPriority, type TicketStatus } from "@nexo/shared";
import { Alert, Badge, EmptyState, PageHeader, SearchInput, Segmented, useDebounced } from "@nexo/ui";
import { get } from "../../lib/api";
import { useLoad } from "../../lib/hooks";
import { ago } from "../auth";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const tone = status === "open" ? "info" : status === "waiting" ? "warning" : "neutral";
  return <Badge tone={tone} plain={status === "closed"}>{TICKET_STATUS_LABELS_OPERATOR[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority === "normal") return null;
  return <Badge tone={priority === "urgent" ? "danger" : "warning"}>{TICKET_PRIORITY_LABELS[priority]}</Badge>;
}

type StatusFilter = "active" | "open" | "waiting" | "closed" | "all";
type AssignedFilter = "all" | "me" | "none";

export function TicketsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = (params.get("estado") ?? "active") as StatusFilter;
  const assigned = (params.get("asignado") ?? "all") as AssignedFilter;
  const tenantId = params.get("negocio") ?? "";
  const query = useDebounced(q);
  const set = (key: string, value: string, def: string) => setParams((p) => { const n = new URLSearchParams(p); if (value === def || !value) n.delete(key); else n.set(key, value); return n; }, { replace: true });
  const search = new URLSearchParams({ status, assigned, ...(tenantId && { tenantId }), ...(query.trim() && { q: query.trim() }) });
  const { data, error, loading } = useLoad(() => get<{ items: SupportTicket[] }>(`/platform/tickets?${search}`), [search.toString()]);
  return (
    <>
      <PageHeader title="Soporte" description="Tickets que abren los negocios desde su panel. Primero los que esperan respuesta y los urgentes." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput value={q} onChange={(v) => { setQ(v); set("q", v, ""); }} placeholder="#número, asunto, negocio o correo" label="Buscar ticket" width={300} />
          <Segmented
            label="Estado"
            value={status}
            onChange={(v) => set("estado", v, "active")}
            options={[{ id: "active", label: "Abiertos" }, { id: "open", label: "Por responder" }, { id: "waiting", label: "Esperando al negocio" }, { id: "closed", label: "Cerrados" }, { id: "all", label: "Todos" }]}
          />
          <Segmented label="Asignación" value={assigned} onChange={(v) => set("asignado", v, "all")} options={[{ id: "all", label: "Todos" }, { id: "me", label: "Míos" }, { id: "none", label: "Sin asignar" }]} />
          {tenantId && <button type="button" className="nx-link" onClick={() => set("negocio", "", "")}>Quitar filtro de negocio</button>}
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState icon={<LifeBuoy className="nx-icon" />} title={status === "active" ? "No hay tickets abiertos" : "Ningún ticket coincide"} text={status === "active" ? "Todo al día." : "Prueba con otro filtro."} />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Ticket</th><th>Negocio</th><th>Estado</th><th>Asignado</th><th>Última actividad</th></tr></thead>
              <tbody>
                {data?.items.map((t) => (
                  <tr key={t.id} data-unread={t.status === "open" || undefined}>
                    <td>
                      <Link className="nx-link nx-strong" to={`/soporte/${t.id}`}>#{t.number} · {t.subject}</Link>
                      <div className="nx-row nx-muted" style={{ gap: 6, fontSize: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <span>{TICKET_CATEGORY_LABELS[t.category]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t.createdByName}</span>
                        {t.allowAccess && <><span aria-hidden="true">·</span><span>Dio permiso para entrar</span></>}
                        <PriorityBadge priority={t.priority} />
                      </div>
                    </td>
                    <td>{t.tenant ? <Link className="nx-link" to={`/negocios/${t.tenant.id}`}>{t.tenant.name}</Link> : "—"}</td>
                    <td><TicketStatusBadge status={t.status} /></td>
                    <td className={t.assignedTo ? undefined : "nx-muted"}>{t.assignedTo?.name ?? "Sin asignar"}</td>
                    <td className="nx-muted" style={{ whiteSpace: "nowrap" }}>{ago(t.lastMessageAt)}</td>
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
