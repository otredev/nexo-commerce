import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, LogIn } from "lucide-react";
import {
  PLANS, TICKET_CATEGORY_LABELS, TICKET_PRIORITIES, TICKET_PRIORITY_LABELS, type PlatformOperator, type PlatformTenantDetail, type SupportTicketDetail, type TicketPriority,
} from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, PageHeader, SelectField, TextAreaField, useToast } from "@nexo/ui";
import { SupportThread } from "../../components/SupportThread";
import { get, patch, post } from "../../lib/api";
import { useLoad, useSubmit } from "../../lib/hooks";
import { fmtDateTime, useOperator } from "../auth";
import { EnterModal } from "./TenantDetail";
import { PriorityBadge, TicketStatusBadge } from "./Tickets";

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { me, refresh, can } = useOperator();
  const { data: t, error, setData } = useLoad(() => get<SupportTicketDetail>(`/platform/tickets/${id}`), [id]);
  const ops = useLoad(() => get<{ items: PlatformOperator[] }>("/platform/operators"), []);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [enter, setEnter] = useState<Pick<PlatformTenantDetail, "id" | "name" | "tickets"> | null>(null);
  const reply = useSubmit(async () => {
    setData(await post<SupportTicketDetail>(`/platform/tickets/${id}/messages`, { body, internal }));
    setBody("");
    toast(internal ? "Nota interna guardada" : "Respuesta enviada al negocio");
    setInternal(false);
    void refresh();
  });
  const update = useSubmit(async (change: Record<string, unknown>, message: string) => {
    setData(await patch<SupportTicketDetail>(`/platform/tickets/${id}`, change));
    toast(message);
    void refresh();
  });
  const openEnter = useSubmit(async () => {
    if (!t?.tenant) return;
    // The modal lists the business's open tickets; this one comes preselected.
    setEnter(await get<PlatformTenantDetail>(`/platform/tenants/${t.tenant.id}`));
  });
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!t) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void reply.submit();
  };

  return (
    <>
      <Link className="nx-backlink" to="/soporte"><ArrowLeft className="nx-icon" aria-hidden="true" />Soporte</Link>
      <PageHeader
        title={`#${t.number} · ${t.subject}`}
        description={<span className="nx-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}><TicketStatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><span className="nx-muted">{TICKET_CATEGORY_LABELS[t.category]} · abierto el {fmtDateTime(t.createdAt)}</span></span>}
        actions={
          t.tenant && can("tenants:enter") && can("tenants:read") && (
            <Button onClick={() => void openEnter.submit()} loading={openEnter.pending} disabled={t.tenant.status !== "active"}>
              <LogIn className="nx-icon" aria-hidden="true" />Entrar como negocio
            </Button>
          )
        }
      />
      {(update.message || openEnter.message) && <Alert tone="danger">{update.message ?? openEnter.message}</Alert>}
      <div className="nx-grid-2">
        <div className="nx-stack" style={{ gap: 16 }}>
          <Card>
            <SupportThread messages={t.thread} viewer="operator" />
          </Card>
          {can("support:reply") && <Card title={internal ? "Nota interna" : "Responder"} description={internal ? "Solo la ve el equipo de Nexo." : `Le llega un correo a ${t.createdByName} (${t.createdByEmail}) y el ticket pasa a «Esperando al negocio».`}>
            <form className="nx-stack" onSubmit={onSubmit} noValidate>
              {reply.message && <Alert tone="danger">{reply.message}</Alert>}
              <TextAreaField label={internal ? "Nota" : "Mensaje"} rows={5} value={body} onChange={(e) => setBody(e.target.value)} error={reply.fields.body} placeholder={internal ? "Contexto para el equipo…" : "Hola, ya revisamos…"} />
              <div className="nx-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Checkbox label="Nota interna (el negocio no la ve)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                <Button type="submit" variant="primary" loading={reply.pending} disabled={!body.trim()}>{internal ? "Guardar nota" : "Enviar respuesta"}</Button>
              </div>
            </form>
          </Card>}
        </div>
        <div className="nx-stack" style={{ gap: 16 }}>
          <Card title="Negocio">
            {t.tenant ? (
              <dl className="nx-kv">
                <div><dt>Nombre</dt><dd><Link className="nx-link" to={`/negocios/${t.tenant.id}`}>{t.tenant.name}</Link></dd></div>
                <div><dt>Plan</dt><dd>{PLANS[t.tenant.plan].name}</dd></div>
                <div><dt>Escribió</dt><dd>{t.createdByName}</dd></div>
                <div><dt>Correo</dt><dd style={{ wordBreak: "break-all" }}>{t.createdByEmail}</dd></div>
                <div><dt>Permiso para entrar</dt><dd>{t.allowAccess ? <Badge tone="success">Sí</Badge> : <Badge plain>No</Badge>}</dd></div>
              </dl>
            ) : <p className="nx-muted" style={{ margin: 0 }}>—</p>}
          </Card>
          {can("support:reply") && <Card title="Gestión">
            <div className="nx-stack" style={{ gap: 12 }}>
              <SelectField label="Asignado a" value={t.assignedTo?.id ?? ""} onChange={(e) => void update.submit({ assignedTo: e.target.value || null }, e.target.value ? "Ticket asignado" : "Ticket sin asignar")}>
                <option value="">Sin asignar</option>
                {ops.data?.items.filter((o) => o.active || o.id === t.assignedTo?.id).map((o) => <option key={o.id} value={o.id}>{o.name}{o.id === me?.operator.id ? " (yo)" : ""}</option>)}
              </SelectField>
              <SelectField label="Prioridad" value={t.priority} onChange={(e) => void update.submit({ priority: e.target.value as TicketPriority }, "Prioridad actualizada")}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
              </SelectField>
              <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {t.status !== "closed"
                  ? <Button onClick={() => void update.submit({ status: "closed" }, "Ticket cerrado")} loading={update.pending}>Cerrar ticket</Button>
                  : <Button onClick={() => void update.submit({ status: "open" }, "Ticket reabierto")} loading={update.pending}>Reabrir</Button>}
                {t.status === "waiting" && <Button variant="ghost" onClick={() => void update.submit({ status: "open" }, "Marcado como por responder")}>Marcar por responder</Button>}
              </div>
              <p className="nx-help" style={{ margin: 0 }}>Si el negocio responde un ticket cerrado, se vuelve a abrir solo.</p>
            </div>
          </Card>}
        </div>
      </div>
      {enter && <EnterModal tenant={enter} open onClose={() => setEnter(null)} ticketId={t.id} />}
    </>
  );
}
