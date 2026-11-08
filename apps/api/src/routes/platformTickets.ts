/**
 * /api/platform/tickets: the support queue. Operators answer (the business gets an email), leave
 * internal notes, assign, set priority and close. Every action goes to the platform log.
 */
import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { control, controlDb } from "@nexo/db";
import {
  effectivePlan, operatorReplySchema, operatorTicketUpdateSchema, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS_OPERATOR,
  type SupportTicket, type SupportTicketDetail,
} from "@nexo/shared";
import type { Env } from "../env";
import { newId } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { inSlices, platformLogEntry, requireOp, type PlatformEnv } from "../lib/operator";
import { notifyBusiness, ticketThread, toTicket, type TicketRow } from "../lib/support";
import { json } from "../lib/validate";

const t = control.supportTickets;

const listQuery = z.object({
  status: z.enum(["active", "open", "waiting", "closed", "all"]).default("active"),
  assigned: z.enum(["all", "me", "none"]).default("all"),
  tenantId: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
});

async function decorate(env: Env, rows: TicketRow[]): Promise<SupportTicket[]> {
  if (!rows.length) return [];
  const cdb = controlDb(env.DB_CONTROL);
  const m = control.supportMessages;
  const [tenants, ops, counts] = await Promise.all([
    inSlices([...new Set(rows.map((r) => r.tenantId))], (slice) => cdb.select().from(control.tenants).where(inArray(control.tenants.id, slice))),
    cdb.select({ id: control.platformOperators.id, name: control.platformOperators.name }).from(control.platformOperators),
    inSlices(rows.map((r) => r.id), (slice) => cdb.select({ ticketId: m.ticketId, n: sql<number>`count(*)` }).from(m).where(and(inArray(m.ticketId, slice), eq(m.internal, false))).groupBy(m.ticketId)),
  ]);
  return rows.map((r) => {
    const biz = tenants.find((x) => x.id === r.tenantId);
    const op = ops.find((o) => o.id === r.assignedTo);
    return toTicket(r, {
      tenant: biz ? { id: biz.id, name: biz.name, slug: biz.slug, plan: effectivePlan(biz.plan, biz.planStatus), status: biz.status } : undefined,
      assignedTo: op ? { id: op.id, name: op.name } : null,
      messages: counts.find((c) => c.ticketId === r.id)?.n ?? 0,
    });
  });
}

async function ticketRow(env: Env, id: string) {
  const row = await controlDb(env.DB_CONTROL).select().from(t).where(eq(t.id, id)).get();
  if (!row) throw new AppError(404, "not_found", "Ticket no encontrado");
  return row;
}

async function detail(env: Env, id: string): Promise<SupportTicketDetail> {
  const row = await ticketRow(env, id);
  const [base] = await decorate(env, [row]);
  return { ...base!, thread: await ticketThread(env, id, true) };
}

export const platformTicketRoutes = new Hono<PlatformEnv>()
  .use("*", requireOp("support:read"))
  .get("/", async (c) => {
    const q = listQuery.parse(c.req.query());
    const me = c.var.operator.operator.id;
    const term = q.q?.toLowerCase();
    const num = term && /^#?\d+$/.test(term) ? Number(term.replace("#", "")) : null;
    const where = and(
      q.status === "active" ? sql`${t.status} <> 'closed'` : q.status === "all" ? undefined : eq(t.status, q.status),
      q.assigned === "me" ? eq(t.assignedTo, me) : q.assigned === "none" ? isNull(t.assignedTo) : undefined,
      q.tenantId ? eq(t.tenantId, q.tenantId) : undefined,
      term
        ? num !== null
          ? eq(t.number, num)
          : or(like(sql`lower(${t.subject})`, `%${term}%`), like(sql`lower(${t.createdByEmail})`, `%${term}%`), sql`${t.tenantId} IN (SELECT id FROM tenants WHERE lower(name) LIKE ${`%${term}%`})`)
        : undefined,
    );
    // Waiting for support first, then urgent, then the oldest without an answer.
    const rows = await controlDb(c.env.DB_CONTROL)
      .select()
      .from(t)
      .where(where)
      .orderBy(sql`CASE ${t.status} WHEN 'open' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END`, sql`CASE ${t.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`, desc(t.lastMessageAt))
      .limit(200);
    return c.json({ items: await decorate(c.env, rows) });
  })

  .get("/:id", async (c) => c.json(await detail(c.env, c.req.param("id"))))

  .post("/:id/messages", requireOp("support:reply"), json(operatorReplySchema), async (c) => {
    const row = await ticketRow(c.env, c.req.param("id"));
    const { body, internal } = c.req.valid("json");
    const op = c.var.operator.operator;
    const cdb = controlDb(c.env.DB_CONTROL);
    const now = new Date().toISOString();
    await cdb.batch([
      cdb.insert(control.supportMessages).values({ id: newId(), ticketId: row.id, authorType: "operator", authorId: op.id, authorName: op.name, body, internal, createdAt: now }),
      // A public answer hands the ticket back to the business (and takes it if nobody had it).
      ...(internal ? [] : [cdb.update(t).set({ status: "waiting", lastMessageAt: now, closedAt: null, assignedTo: row.assignedTo ?? op.id }).where(eq(t.id, row.id))]),
      platformLogEntry(c, { action: internal ? "ticket.note" : "ticket.reply", entity: "ticket", entityId: row.id, tenantId: row.tenantId, summary: `#${row.number} ${row.subject}` }),
    ] as unknown as Parameters<typeof cdb.batch>[0]);
    if (!internal) c.executionCtx.waitUntil(notifyBusiness(c.env, row, body).catch((e) => console.error("[support] notify business", e)));
    return c.json(await detail(c.env, row.id));
  })

  .patch("/:id", requireOp("support:reply"), json(operatorTicketUpdateSchema), async (c) => {
    const row = await ticketRow(c.env, c.req.param("id"));
    const input = c.req.valid("json");
    const op = c.var.operator.operator;
    const cdb = controlDb(c.env.DB_CONTROL);
    const set: Partial<typeof t.$inferInsert> = {};
    const changes: string[] = [];
    const visible: string[] = [];
    if (input.status && input.status !== row.status) {
      set.status = input.status;
      set.closedAt = input.status === "closed" ? new Date().toISOString() : null;
      changes.push(`Estado: ${TICKET_STATUS_LABELS_OPERATOR[row.status]} → ${TICKET_STATUS_LABELS_OPERATOR[input.status]}`);
      if (input.status === "closed") visible.push(`${op.name} (soporte) cerró el ticket. Si necesitas algo más, respóndelo y se vuelve a abrir.`);
      if (row.status === "closed") visible.push(`${op.name} (soporte) reabrió el ticket.`);
    }
    if (input.priority && input.priority !== row.priority) {
      set.priority = input.priority;
      changes.push(`Prioridad: ${TICKET_PRIORITY_LABELS[row.priority]} → ${TICKET_PRIORITY_LABELS[input.priority]}`);
    }
    if (input.assignedTo !== undefined && input.assignedTo !== row.assignedTo) {
      let name = "nadie";
      if (input.assignedTo) {
        const target = await cdb.select().from(control.platformOperators).where(and(eq(control.platformOperators.id, input.assignedTo), eq(control.platformOperators.active, true))).get();
        if (!target) throw new AppError(422, "validation_error", "Operador no válido", { assignedTo: "Elige un operador activo" });
        name = target.name;
      }
      set.assignedTo = input.assignedTo;
      changes.push(`Asignado a ${name}`);
    }
    if (changes.length) {
      await cdb.batch([
        cdb.update(t).set(set).where(eq(t.id, row.id)),
        ...visible.map((body) => cdb.insert(control.supportMessages).values({ id: newId(), ticketId: row.id, authorType: "system", authorName: "Nexo", body })),
        platformLogEntry(c, { action: "ticket.update", entity: "ticket", entityId: row.id, tenantId: row.tenantId, summary: `#${row.number} · ${changes.join(" · ")}` }),
      ] as unknown as Parameters<typeof cdb.batch>[0]);
    }
    return c.json(await detail(c.env, row.id));
  });
