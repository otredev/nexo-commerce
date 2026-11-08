/**
 * Soporte (business side): tickets with the Nexo team. Owners and admins open them, reply, close them
 * and decide whether support may enter the account to look into each one.
 */
import { Hono } from "hono";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { ticketBusinessUpdateSchema, ticketCreateSchema, ticketReplySchema, type SupportTicket, type SupportTicketDetail } from "@nexo/shared";
import type { AppEnv } from "../env";
import { newId } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { notifyOperators, ticketThread, toTicket } from "../lib/support";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const t = control.supportTickets;

async function own(c: { env: AppEnv["Bindings"]; var: AppEnv["Variables"] }, id: string) {
  const row = await controlDb(c.env.DB_CONTROL).select().from(t).where(and(eq(t.id, id), eq(t.tenantId, c.var.auth.tenant.id))).get();
  if (!row) throw new AppError(404, "not_found", "Ticket no encontrado");
  return row;
}

async function detail(c: { env: AppEnv["Bindings"]; var: AppEnv["Variables"] }, id: string): Promise<SupportTicketDetail> {
  const row = await own(c, id);
  return { ...toTicket(row), thread: await ticketThread(c.env, row.id, false) };
}

export const supportRoutes = new Hono<AppEnv>()
  .use("*", requirePermission("support:use"))

  .get("/tickets", async (c) => {
    const cdb = controlDb(c.env.DB_CONTROL);
    const m = control.supportMessages;
    const rows = await cdb
      .select({ ticket: t, messages: sql<number>`(SELECT COUNT(*) FROM ${m} WHERE ${m.ticketId} = ${t.id} AND ${m.internal} = 0)` })
      .from(t)
      .where(eq(t.tenantId, c.var.auth.tenant.id))
      .orderBy(desc(t.lastMessageAt))
      .limit(200);
    return c.json({ items: rows.map((r): SupportTicket => toTicket(r.ticket, { messages: r.messages })) });
  })

  .post("/tickets", json(ticketCreateSchema), async (c) => {
    const input = c.req.valid("json");
    const { user, tenant: biz } = c.var.auth;
    const cdb = controlDb(c.env.DB_CONTROL);
    // Few open tickets at a time keeps the queue honest (and a script from flooding it).
    const [open] = await cdb.select({ n: count() }).from(t).where(and(eq(t.tenantId, biz.id), sql`${t.status} <> 'closed'`));
    if ((open?.n ?? 0) >= 10) throw new AppError(429, "too_many_tickets", "Tienes 10 tickets abiertos. Cierra los que ya se resolvieron para abrir otro.");
    const id = newId();
    const now = new Date().toISOString();
    await cdb.batch([
      cdb.insert(t).values({
        id,
        // Platform-wide sequential number, assigned inside the INSERT (no gaps between two at once).
        number: sql`(SELECT COALESCE(MAX(${t.number}), 1000) + 1 FROM ${t})`,
        tenantId: biz.id,
        createdBy: user.id,
        createdByName: user.name,
        createdByEmail: user.email,
        subject: input.subject,
        category: input.category,
        priority: input.category === "problem" ? "high" : "normal",
        allowAccess: input.allowAccess,
        lastMessageAt: now,
        createdAt: now,
      }),
      cdb.insert(control.supportMessages).values({ id: newId(), ticketId: id, authorType: "user", authorId: user.id, authorName: user.name, body: input.body, createdAt: now }),
    ]);
    const row = await own(c, id);
    c.executionCtx.waitUntil(notifyOperators(c.env, row, biz.name, input.body, true).catch((e) => console.error("[support] notify", e)));
    return c.json(await detail(c, id), 201);
  })

  .get("/tickets/:id", async (c) => c.json(await detail(c, c.req.param("id"))))

  .post("/tickets/:id/messages", json(ticketReplySchema), async (c) => {
    const row = await own(c, c.req.param("id"));
    const { user, tenant: biz } = c.var.auth;
    const { body } = c.req.valid("json");
    const cdb = controlDb(c.env.DB_CONTROL);
    const now = new Date().toISOString();
    // Writing again reopens the ticket: it goes back to support's queue.
    await cdb.batch([
      cdb.insert(control.supportMessages).values({ id: newId(), ticketId: row.id, authorType: "user", authorId: user.id, authorName: user.name, body, createdAt: now }),
      cdb.update(t).set({ status: "open", lastMessageAt: now, closedAt: null }).where(eq(t.id, row.id)),
    ]);
    c.executionCtx.waitUntil(notifyOperators(c.env, row, biz.name, body, false).catch((e) => console.error("[support] notify", e)));
    return c.json(await detail(c, row.id));
  })

  .patch("/tickets/:id", json(ticketBusinessUpdateSchema), async (c) => {
    const row = await own(c, c.req.param("id"));
    const input = c.req.valid("json");
    const { user } = c.var.auth;
    const cdb = controlDb(c.env.DB_CONTROL);
    const set: Partial<typeof t.$inferInsert> = {};
    const notes: string[] = [];
    if (input.allowAccess !== undefined && input.allowAccess !== row.allowAccess) {
      set.allowAccess = input.allowAccess;
      notes.push(input.allowAccess ? `${user.name} permitió que soporte entre a la cuenta para revisar este ticket.` : `${user.name} retiró el permiso para que soporte entre a la cuenta.`);
    }
    if (input.status === "closed" && row.status !== "closed") {
      Object.assign(set, { status: "closed", closedAt: new Date().toISOString() });
      notes.push(`${user.name} cerró el ticket.`);
    }
    if (input.status === "open" && row.status === "closed") {
      Object.assign(set, { status: "open", closedAt: null });
      notes.push(`${user.name} reabrió el ticket.`);
    }
    if (notes.length) {
      await cdb.batch([
        cdb.update(t).set(set).where(eq(t.id, row.id)),
        ...notes.map((body) => cdb.insert(control.supportMessages).values({ id: newId(), ticketId: row.id, authorType: "system", authorName: "Nexo", body })),
      ] as unknown as Parameters<typeof cdb.batch>[0]);
    }
    return c.json(await detail(c, row.id));
  });
