/** Support tickets: shapes shared by the business side (/api/support) and /admin (/api/platform/tickets). */
import { asc, and, eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { TICKET_CATEGORY_LABELS, type SupportMessage, type SupportTicket } from "@nexo/shared";
import type { Env } from "../env";
import { sendEmail } from "./email";

export type TicketRow = typeof control.supportTickets.$inferSelect;

export const toTicket = (r: TicketRow, extra: Partial<SupportTicket> = {}): SupportTicket => ({
  id: r.id,
  number: r.number,
  subject: r.subject,
  category: r.category,
  priority: r.priority,
  status: r.status,
  allowAccess: r.allowAccess,
  createdByName: r.createdByName,
  createdByEmail: r.createdByEmail,
  lastMessageAt: r.lastMessageAt,
  closedAt: r.closedAt,
  createdAt: r.createdAt,
  ...extra,
});

export async function ticketThread(env: Env, ticketId: string, includeInternal: boolean): Promise<SupportMessage[]> {
  const m = control.supportMessages;
  const rows = await controlDb(env.DB_CONTROL)
    .select()
    .from(m)
    .where(includeInternal ? eq(m.ticketId, ticketId) : and(eq(m.ticketId, ticketId), eq(m.internal, false)))
    .orderBy(asc(m.createdAt), asc(m.id));
  return rows.map((r) => ({ id: r.id, authorType: r.authorType, authorName: r.authorName, body: r.body, internal: r.internal, createdAt: r.createdAt }));
}

const clip = (text: string, n = 600) => (text.length > n ? `${text.slice(0, n)}…` : text);

/** New ticket or a new message from a business: every active operator gets an email. */
export async function notifyOperators(env: Env, t: TicketRow, tenantName: string, body: string, isNew: boolean) {
  const ops = await controlDb(env.DB_CONTROL).select({ email: control.platformOperators.email }).from(control.platformOperators).where(eq(control.platformOperators.active, true));
  const url = `${env.APP_URL}/admin/soporte/${t.id}`;
  const subject = isNew ? `Ticket #${t.number} · ${tenantName}: ${t.subject}` : `Respuesta en el ticket #${t.number} · ${tenantName}`;
  const text = `${isNew ? `Nuevo ticket (${TICKET_CATEGORY_LABELS[t.category]})` : "El negocio respondió"} de ${t.createdByName} en ${tenantName}:\n\n${clip(body)}\n\nResponder: ${url}`;
  await Promise.all(ops.map((o) => sendEmail(env, { to: o.email, subject, text })));
}

/** Support answered: the person who opened the ticket gets an email with the answer. */
export async function notifyBusiness(env: Env, t: TicketRow, body: string) {
  const url = `${env.APP_URL}/soporte/${t.id}`;
  await sendEmail(env, {
    to: t.createdByEmail,
    subject: `Soporte de Nexo respondió tu ticket #${t.number}`,
    text: `Hola ${t.createdByName}:\n\nRespondimos tu ticket «${t.subject}»:\n\n${clip(body)}\n\nVer la conversación y responder: ${url}`,
  });
}
