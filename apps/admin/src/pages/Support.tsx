/**
 * Soporte: tickets with the Nexo team. Owners and admins open them, follow the conversation and decide
 * whether support may enter the account to look into each one.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, LifeBuoy, Plus } from "lucide-react";
import {
  TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, type SupportTicket, type SupportTicketDetail, type TicketCategory, type TicketStatus,
} from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Modal, PageHeader, SelectField, Switch, TextAreaField, TextField, useToast } from "@nexo/ui";
import { SupportThread } from "../components/SupportThread";
import { get, patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

const when = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={status === "waiting" ? "success" : status === "open" ? "info" : "neutral"} plain={status === "closed"}>{TICKET_STATUS_LABELS[status]}</Badge>;
}

export function SupportPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useLoad(() => get<{ items: SupportTicket[] }>("/support/tickets"), []);
  const [creating, setCreating] = useState(false);
  useEffect(() => { document.title = "Soporte · Nexo"; }, []);
  return (
    <>
      <PageHeader
        title="Soporte"
        description="Escríbenos si algo no funciona, tienes una duda o quieres sugerir algo. Te respondemos aquí y por correo."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="nx-icon" aria-hidden="true" />Nuevo ticket</Button>}
      />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="nx-icon" />}
            title="Aún no tienes tickets"
            text={<>Antes de escribir, quizá la respuesta ya está en la <Link className="nx-link" to="/ayuda">ayuda</Link>.</>}
            actions={<Button onClick={() => setCreating(true)}>Escribir a soporte</Button>}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Ticket</th><th>Estado</th><th>Última actividad</th></tr></thead>
              <tbody>
                {data?.items.map((t) => (
                  <tr key={t.id} data-unread={t.status === "waiting" || undefined}>
                    <td>
                      <Link className="nx-link nx-strong" to={`/soporte/${t.id}`}>#{t.number} · {t.subject}</Link>
                      <div className="nx-muted" style={{ fontSize: 12 }}>{TICKET_CATEGORY_LABELS[t.category]} · {t.createdByName} · {t.messages ?? 0} {t.messages === 1 ? "mensaje" : "mensajes"}</div>
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="nx-muted" style={{ whiteSpace: "nowrap" }}>{when.format(new Date(t.lastMessageAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewTicketModal open={creating} onClose={() => setCreating(false)} onCreated={(t) => { void refresh(); navigate(`/soporte/${t.id}`); }} />
    </>
  );
}

function NewTicketModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: SupportTicketDetail) => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("question");
  const [body, setBody] = useState("");
  const [allowAccess, setAllowAccess] = useState(false);
  const save = useSubmit(async () => {
    const t = await post<SupportTicketDetail>("/support/tickets", { subject, category, body, allowAccess });
    toast(`Ticket #${t.number} enviado. Te avisaremos por correo cuando respondamos.`);
    setSubject("");
    setBody("");
    setAllowAccess(false);
    setCategory("question");
    onClose();
    onCreated(t);
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save.submit();
  };
  return (
    <Modal open={open} title="Escribir a soporte" size="lg" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="new-ticket" loading={save.pending}>Enviar</Button></>}>
      <form id="new-ticket" className="nx-stack" onSubmit={onSubmit} noValidate>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <div className="nx-grid-2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 12 }}>
          <TextField label="Asunto" value={subject} onChange={(e) => setSubject(e.target.value)} error={save.fields.subject} placeholder="El corte de caja no cuadra" autoFocus />
          <SelectField label="Tipo" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
            {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{TICKET_CATEGORY_LABELS[c]}</option>)}
          </SelectField>
        </div>
        <TextAreaField
          label="Cuéntanos qué pasa"
          rows={7}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={save.fields.body}
          help="Si algo no funciona: qué hiciste, qué esperabas y qué pasó. El folio de la venta o el pedido nos ayuda mucho."
        />
        <Checkbox
          label="Permitir que soporte entre a mi cuenta para revisar este ticket"
          help="Solo si hace falta, durante una hora y quedando registrado en tu Actividad. Soporte no puede ver ni cambiar tu plan y pagos, usuarios, llaves ni contraseñas."
          checked={allowAccess}
          onChange={(e) => setAllowAccess(e.target.checked)}
        />
      </form>
    </Modal>
  );
}

export function SupportTicketPage() {
  const { id = "" } = useParams();
  const { refresh } = useAuth();
  const toast = useToast();
  const { data: t, error, setData } = useLoad(() => get<SupportTicketDetail>(`/support/tickets/${id}`), [id]);
  const [body, setBody] = useState("");
  // Opening an answered ticket clears the "Soporte" badge in the menu.
  useEffect(() => { if (t) void refresh(); }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (t) document.title = `Ticket #${t.number} · Nexo`; }, [t]);
  const reply = useSubmit(async () => {
    setData(await post<SupportTicketDetail>(`/support/tickets/${id}/messages`, { body }));
    setBody("");
    toast("Mensaje enviado a soporte");
  });
  const update = useSubmit(async (change: { allowAccess?: boolean; status?: "open" | "closed" }, message: string) => {
    setData(await patch<SupportTicketDetail>(`/support/tickets/${id}`, change));
    toast(message);
    void refresh();
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
        description={<span className="nx-row" style={{ gap: 8, alignItems: "center" }}><StatusBadge status={t.status} /><span className="nx-muted">{TICKET_CATEGORY_LABELS[t.category]} · abierto por {t.createdByName}</span></span>}
        actions={t.status !== "closed"
          ? <Button onClick={() => void update.submit({ status: "closed" }, "Ticket cerrado")} loading={update.pending}>Ya se resolvió, cerrar</Button>
          : <Button onClick={() => void update.submit({ status: "open" }, "Ticket reabierto")} loading={update.pending}>Reabrir</Button>}
      />
      {(update.message || reply.message) && <Alert tone="danger">{update.message ?? reply.message}</Alert>}
      {t.status === "waiting" && <Alert tone="success" title="Soporte te respondió">Si con eso se resolvió, cierra el ticket. Si no, respóndenos abajo.</Alert>}
      <Card>
        <SupportThread messages={t.thread} viewer="business" />
      </Card>
      <Card title={t.status === "closed" ? "Responder y reabrir" : "Responder"}>
        <form className="nx-stack" onSubmit={onSubmit} noValidate>
          <TextAreaField label="Mensaje" rows={4} value={body} onChange={(e) => setBody(e.target.value)} error={reply.fields.body} />
          <div className="nx-row" style={{ justifyContent: "space-between", gap: 12 }}>
            <Switch
              label="Soporte puede entrar a mi cuenta para revisar"
              checked={t.allowAccess}
              disabled={update.pending}
              onChange={(v) => void update.submit({ allowAccess: v }, v ? "Soporte puede entrar a revisar este ticket" : "Permiso retirado")}
            />
            <Button type="submit" variant="primary" loading={reply.pending} disabled={!body.trim()}>Enviar</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
