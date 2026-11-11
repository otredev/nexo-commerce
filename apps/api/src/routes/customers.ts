import { Hono, type Context } from "hono";
import { and, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import { customerSchema, fromMilli, normalizeSearch, type Customer, type CustomerDetail, type Paginated, type UnitCode } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { toStatement } from "../lib/inventory";
import { customerSearchText, matchCustomer, normalizeEmail, normalizePhone } from "../lib/pricing";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { customers } = tenant;

/**
 * Purchases of a customer: completed POS sales (net of returns) and delivered online orders.
 * One SQL fragment so the list and the detail agree.
 */
const STATS = `
  SELECT customer_id, COUNT(*) AS purchases, SUM(amount) AS total, MAX(at) AS last_at FROM (
    SELECT customer_id, total_cents - refunded_cents AS amount, created_at AS at FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND customer_id IS NOT NULL
    UNION ALL
    SELECT customer_id, total_cents AS amount, completed_at AS at FROM orders WHERE tenant_id = ?1 AND status = 'completed' AND customer_id IS NOT NULL
  ) GROUP BY customer_id`;

type Row = typeof customers.$inferSelect;
const toCustomer = (r: Row, s?: { purchases: number; total: number; last_at: string | null }, accountSince: string | null = null): Customer => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  taxId: r.taxId,
  address: r.address,
  notes: r.notes,
  acceptsMarketing: r.acceptsMarketing,
  source: r.source,
  archived: r.archived,
  createdAt: r.createdAt,
  purchases: s?.purchases ?? 0,
  totalCents: s?.total ?? 0,
  lastPurchaseAt: s?.last_at ?? null,
  avgTicketCents: s?.purchases ? Math.round(s.total / s.purchases) : 0,
  accountSince,
});

/** When the customer opened an account in the online store (null: never). */
const ACCOUNT_AT = "(SELECT MIN(a.created_at) FROM customer_accounts a WHERE a.tenant_id = c.tenant_id AND a.customer_id = c.id)";

async function getCustomer(c: Context<AppEnv>, id: string) {
  const { db, tenant: t } = c.var.auth;
  const row = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, t.id))).get();
  if (!row) throw notFound("Cliente");
  return row;
}

/** Same email or phone as another customer → 409 with the field, so nobody is duplicated by accident. */
async function checkDuplicate(c: Context<AppEnv>, email: string | null, phone: string | null, exceptId?: string) {
  const { db, tenant: t } = c.var.auth;
  const found = await matchCustomer(db, t.id, email, phone);
  if (found && found.id !== exceptId) {
    const field = email && found.email === email ? "email" : "phone";
    throw new AppError(409, "duplicate", `Ya existe un cliente con ese ${field === "email" ? "correo" : "teléfono"}: ${found.name}.`, { [field]: `Ya es de ${found.name}`, existingId: found.id });
  }
}

const listQuery = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(["recent", "name", "total", "last"]).default("recent"),
  status: z.enum(["active", "archived"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const customerRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("customers:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t } = c.var.auth;
    const params: unknown[] = [t.id];
    const where = ["c.tenant_id = ?1", `c.archived = ${query.status === "archived" ? 1 : 0}`];
    if (query.q?.trim()) {
      const digits = query.q.replace(/\D/g, "");
      params.push(normalizeSearch(query.q));
      const text = `instr(c.search_text, ?${params.length}) > 0`;
      if (digits.length >= 4) {
        params.push(digits);
        where.push(`(${text} OR instr(COALESCE(c.phone, ''), ?${params.length}) > 0)`);
      } else where.push(text);
    }
    const order = { recent: "c.created_at DESC", name: "c.name COLLATE NOCASE", total: "COALESCE(s.total, 0) DESC", last: "s.last_at IS NULL, s.last_at DESC" }[query.sort];
    const from = `FROM customers c LEFT JOIN (${STATS}) s ON s.customer_id = c.id WHERE ${where.join(" AND ")}`;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total FROM customers c WHERE ${where.join(" AND ")}`).bind(...params),
      d1.prepare(`SELECT c.*, s.purchases, s.total, s.last_at, ${ACCOUNT_AT} AS account_at ${from} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`).bind(...params),
    ]);
    const items = (rows!.results as Array<Record<string, unknown>>).map((r) =>
      toCustomer(
        {
          id: r.id as string, tenantId: t.id, name: r.name as string, email: r.email as string | null, phone: r.phone as string | null, taxId: r.tax_id as string | null,
          address: r.address as string | null, notes: r.notes as string | null, acceptsMarketing: Boolean(r.accepts_marketing), source: r.source as Row["source"],
          archived: Boolean(r.archived), searchText: "", createdAt: r.created_at as string, updatedAt: r.updated_at as string,
        },
        r.purchases ? { purchases: r.purchases as number, total: r.total as number, last_at: r.last_at as string | null } : undefined,
        (r.account_at as string | null) ?? null,
      ),
    );
    const body: Paginated<Customer> = { items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  /** Every active customer as CSV (Excel opens it with accents thanks to the BOM). */
  .get("/export", requirePermission("customers:read"), async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const { results } = await d1
      .prepare(`SELECT c.*, s.purchases, s.total, s.last_at FROM customers c LEFT JOIN (${STATS}) s ON s.customer_id = c.id WHERE c.tenant_id = ?1 AND c.archived = 0 ORDER BY c.name COLLATE NOCASE`)
      .bind(t.id)
      .all<Record<string, unknown>>();
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Nombre", "Correo", "Teléfono", "RFC", "Dirección", "Acepta promociones", "Compras", "Total comprado", "Última compra", "Alta"];
    const lines = results.map((r) =>
      [r.name, r.email, r.phone, r.tax_id, r.address, r.accepts_marketing ? "Sí" : "No", r.purchases ?? 0, (((r.total as number) ?? 0) / 100).toFixed(2), (r.last_at as string | null)?.slice(0, 10) ?? "", (r.created_at as string).slice(0, 10)].map(esc).join(","),
    );
    return new Response(`﻿${[header.join(","), ...lines].join("\r\n")}`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="clientes.csv"` },
    });
  })

  /** «Ya soy cliente» at the register: the customer by phone (exact digits, or the same last 10). */
  .get("/lookup", requirePermission("customers:read"), async (c) => {
    const digits = normalizePhone(c.req.query("phone"));
    if (!digits) throw new AppError(422, "validation_error", "Teléfono no válido", { phone: "Escribe el teléfono completo" });
    const { db, tenant: t } = c.var.auth;
    const last10 = digits.slice(-10);
    const rows = await db.select().from(customers).where(and(eq(customers.tenantId, t.id), eq(customers.archived, false), or(eq(customers.phone, digits), like(customers.phone, `%${last10}`))));
    const found = rows.find((r) => r.phone === digits) ?? (rows.length === 1 ? rows[0] : null);
    if (!found) throw notFound("Cliente");
    return c.json(toCustomer(await getCustomer(c, found.id)));
  })

  .get("/:id", requirePermission("customers:read"), async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const row = await getCustomer(c, c.req.param("id"));
    const [stats, history, top, account] = await d1.batch([
      d1.prepare(`SELECT * FROM (${STATS}) WHERE customer_id = ?2`).bind(t.id, row.id),
      d1
        .prepare(
          `SELECT 'sale' AS kind, s.id, s.number, s.created_at AS date, s.total_cents - s.refunded_cents AS total, s.status,
             (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS items, l.name AS channel
           FROM sales s LEFT JOIN locations l ON l.id = s.location_id WHERE s.tenant_id = ?1 AND s.customer_id = ?2
           UNION ALL
           SELECT 'order', o.id, o.number, o.created_at, o.total_cents, o.status, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id), 'Tienda en línea'
           FROM orders o WHERE o.tenant_id = ?1 AND o.customer_id = ?2
           ORDER BY date DESC LIMIT 100`,
        )
        .bind(t.id, row.id),
      d1
        .prepare(
          `SELECT product_id, name, unit, SUM(qty) AS qty, SUM(total) AS total FROM (
             SELECT i.product_id, i.name, i.unit, i.quantity - i.returned_quantity AS qty, i.total_cents AS total
             FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.tenant_id = ?1 AND s.customer_id = ?2 AND s.status = 'completed'
             UNION ALL
             SELECT i.product_id, i.name, i.unit, i.quantity, i.total_cents FROM order_items i JOIN orders o ON o.id = i.order_id
             WHERE o.tenant_id = ?1 AND o.customer_id = ?2 AND o.status = 'completed'
           ) GROUP BY product_id ORDER BY total DESC LIMIT 5`,
        )
        .bind(t.id, row.id),
      d1.prepare(`SELECT ${ACCOUNT_AT.replaceAll("c.tenant_id", "?1").replaceAll("c.id", "?2")} AS at`).bind(t.id, row.id),
    ]);
    const s = stats!.results[0] as { purchases: number; total: number; last_at: string | null } | undefined;
    const body: CustomerDetail = {
      ...toCustomer(row, s, ((account!.results[0] as { at: string | null } | undefined)?.at) ?? null),
      history: (history!.results as Array<Record<string, unknown>>).map((h) => ({
        kind: h.kind as "sale" | "order",
        id: h.id as string,
        number: h.number as number,
        date: h.date as string,
        totalCents: h.total as number,
        status: h.status as string,
        items: h.items as number,
        channelLabel: (h.channel as string | null) ?? "—",
      })),
      topProducts: (top!.results as Array<Record<string, unknown>>).map((p) => ({
        productId: p.product_id as string,
        name: p.name as string,
        unit: p.unit as UnitCode,
        quantity: fromMilli(p.qty as number),
        totalCents: p.total as number,
      })),
    };
    return c.json(body);
  })

  .post("/", requirePermission("customers:write"), json(customerSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    if (input.phone && !phone) throw new AppError(422, "validation_error", "Revisa los campos marcados", { phone: "Teléfono incompleto" });
    await checkDuplicate(c, email, phone);
    const id = newId();
    const values = { ...input, email, phone };
    await d1.batch([
      toStatement(d1, db.insert(customers).values({ id, tenantId: t.id, ...values, source: c.req.query("origen") === "pos" ? "pos" : "admin", searchText: customerSearchText(values) })),
      toStatement(d1, auditEntry(c, { action: "customer.create", entity: "customer", entityId: id, after: { name: input.name } })),
    ]);
    return c.json(toCustomer((await getCustomer(c, id))), 201);
  })

  .put("/:id", requirePermission("customers:write"), json(customerSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const before = await getCustomer(c, c.req.param("id"));
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    if (input.phone && !phone) throw new AppError(422, "validation_error", "Revisa los campos marcados", { phone: "Teléfono incompleto" });
    await checkDuplicate(c, email, phone, before.id);
    const values = { ...input, email, phone };
    const change = diff(before as unknown as Record<string, unknown>, values);
    if (change.changed) {
      await d1.batch([
        toStatement(d1, db.update(customers).set({ ...values, searchText: customerSearchText(values), updatedAt: new Date().toISOString() }).where(and(eq(customers.id, before.id), eq(customers.tenantId, t.id)))),
        toStatement(d1, auditEntry(c, { action: "customer.update", entity: "customer", entityId: before.id, before: change.before, after: change.after })),
      ]);
    }
    return c.json(toCustomer(await getCustomer(c, before.id)));
  })

  /** Archive or restore. Customers are never deleted: their purchases keep pointing to them. */
  .post("/:id/archive", requirePermission("customers:write"), json(z.object({ archived: z.boolean() })), async (c) => {
    const { archived } = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const row = await getCustomer(c, c.req.param("id"));
    await d1.batch([
      toStatement(d1, db.update(customers).set({ archived, updatedAt: new Date().toISOString() }).where(and(eq(customers.id, row.id), eq(customers.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: archived ? "customer.archive" : "customer.restore", entity: "customer", entityId: row.id, after: { name: row.name } })),
    ]);
    return c.json(toCustomer(await getCustomer(c, row.id)));
  });
