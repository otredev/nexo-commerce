import { Hono, type Context } from "hono";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import { supplierSchema, type Supplier } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { toStatement } from "../lib/inventory";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { suppliers, purchaseOrders } = tenant;

const duplicate = () => new AppError(409, "duplicate", "Ya existe un proveedor con ese nombre", { name: "Ya existe un proveedor con ese nombre" });

type Row = typeof suppliers.$inferSelect;
const toSupplier = (s: Row, stats?: { orders: number; open: number; received: number; last: string | null }): Supplier => ({
  id: s.id,
  name: s.name,
  contactName: s.contactName,
  email: s.email,
  phone: s.phone,
  taxId: s.taxId,
  address: s.address,
  paymentTermsDays: s.paymentTermsDays,
  notes: s.notes,
  active: s.active,
  createdAt: s.createdAt,
  ...(stats && { ordersCount: stats.orders, openOrdersCount: stats.open, receivedCents: stats.received, lastOrderAt: stats.last }),
});

async function nameTaken(c: Context<AppEnv>, name: string, exceptId?: string) {
  const { db, tenant: t } = c.var.auth;
  const conds = [eq(suppliers.tenantId, t.id), sql`lower(${suppliers.name}) = lower(${name})`];
  if (exceptId) conds.push(ne(suppliers.id, exceptId));
  return Boolean(await db.select({ id: suppliers.id }).from(suppliers).where(and(...conds)).get());
}

export const supplierRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("suppliers:read"), async (c) => {
    const query = z.object({ q: z.string().max(100).optional(), status: z.enum(["active", "inactive", "all"]).default("active") }).parse(c.req.query());
    const { d1, tenant: t } = c.var.auth;
    const params: unknown[] = [t.id];
    const where = ["s.tenant_id = ?1"];
    if (query.status !== "all") where.push(`s.active = ${query.status === "active" ? 1 : 0}`);
    if (query.q?.trim()) {
      params.push(query.q.trim().toLowerCase());
      where.push(`instr(lower(s.name || ' ' || COALESCE(s.contact_name, '') || ' ' || COALESCE(s.tax_id, '') || ' ' || COALESCE(s.email, '')), ?${params.length}) > 0`);
    }
    const { results } = await d1
      .prepare(
        `SELECT s.*,
           (SELECT COUNT(*) FROM purchase_orders o WHERE o.supplier_id = s.id AND o.status NOT IN ('draft', 'cancelled')) AS orders,
           (SELECT COUNT(*) FROM purchase_orders o WHERE o.supplier_id = s.id AND o.status IN ('ordered', 'partial')) AS open_orders,
           (SELECT COALESCE(SUM(received_cents), 0) FROM purchase_orders o WHERE o.supplier_id = s.id) AS received,
           (SELECT MAX(COALESCE(ordered_at, created_at)) FROM purchase_orders o WHERE o.supplier_id = s.id AND o.status <> 'cancelled') AS last_order
         FROM suppliers s WHERE ${where.join(" AND ")} ORDER BY s.name COLLATE NOCASE`,
      )
      .bind(...params)
      .all<Record<string, unknown>>();
    const items = results.map((r) =>
      toSupplier(
        {
          id: r.id as string, tenantId: t.id, name: r.name as string, contactName: r.contact_name as string | null, email: r.email as string | null,
          phone: r.phone as string | null, taxId: r.tax_id as string | null, address: r.address as string | null, paymentTermsDays: r.payment_terms_days as number,
          notes: r.notes as string | null, active: Boolean(r.active), createdAt: r.created_at as string, updatedAt: r.updated_at as string,
        },
        { orders: r.orders as number, open: r.open_orders as number, received: r.received as number, last: r.last_order as string | null },
      ),
    );
    return c.json(items);
  })

  .get("/:id", requirePermission("suppliers:read"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const s = await db.select().from(suppliers).where(and(eq(suppliers.id, c.req.param("id")), eq(suppliers.tenantId, t.id))).get();
    if (!s) throw notFound("Proveedor");
    return c.json(toSupplier(s));
  })

  .post("/", requirePermission("suppliers:write"), json(supplierSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    if (await nameTaken(c, input.name)) throw duplicate();
    const id = newId();
    await d1.batch([
      toStatement(d1, db.insert(suppliers).values({ id, tenantId: t.id, ...input })),
      toStatement(d1, auditEntry(c, { action: "supplier.create", entity: "supplier", entityId: id, after: input })),
    ]);
    const s = await db.select().from(suppliers).where(eq(suppliers.id, id)).get();
    return c.json(toSupplier(s!), 201);
  })

  .put("/:id", requirePermission("suppliers:write"), json(supplierSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const { db, d1, tenant: t } = c.var.auth;
    const before = await db.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, t.id))).get();
    if (!before) throw notFound("Proveedor");
    if (await nameTaken(c, input.name, id)) throw duplicate();
    const change = diff(before as unknown as Record<string, unknown>, input);
    if (change.changed) {
      await d1.batch([
        toStatement(d1, db.update(suppliers).set({ ...input, updatedAt: new Date().toISOString() }).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, t.id)))),
        toStatement(d1, auditEntry(c, { action: "supplier.update", entity: "supplier", entityId: id, before: change.before, after: change.after })),
      ]);
    }
    const s = await db.select().from(suppliers).where(eq(suppliers.id, id)).get();
    return c.json(toSupplier(s!));
  })

  /** Only suppliers without orders can be deleted; the rest are deactivated to keep the history. */
  .delete("/:id", requirePermission("suppliers:write"), async (c) => {
    const id = c.req.param("id");
    const { db, d1, tenant: t } = c.var.auth;
    const s = await db.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, t.id))).get();
    if (!s) throw notFound("Proveedor");
    const used = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, t.id), eq(purchaseOrders.supplierId, id))).get();
    if (used) throw new AppError(409, "in_use", "Este proveedor tiene órdenes de compra. Desactívalo para ocultarlo sin perder el historial.");
    await d1.batch([
      toStatement(d1, db.delete(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: "supplier.delete", entity: "supplier", entityId: id, before: { name: s.name } })),
    ]);
    return c.body(null, 204);
  });
