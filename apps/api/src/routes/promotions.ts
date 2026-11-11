import { Hono, type Context } from "hono";
import { and, eq, inArray, ne } from "drizzle-orm";
import { tenant } from "@nexo/db";
import { businessDate, couponProblem, couponSchema, promotionSchema, type Coupon, type Promotion } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { chunk, toStatement } from "../lib/inventory";
import { findCoupon, livePromotions, toCouponRule, toPromotionRule } from "../lib/pricing";
import { getSettings } from "../lib/sales";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { promotions, coupons, categories, products } = tenant;

async function namesFor(c: Context<AppEnv>, target: "all" | "category" | "product", ids: string[]) {
  if (target === "all" || !ids.length) return [];
  const { db, tenant: t } = c.var.auth;
  const table = target === "category" ? categories : products;
  const out: string[] = [];
  for (const part of chunk(ids)) {
    const rows = await db.select({ id: table.id, name: table.name }).from(table).where(and(eq(table.tenantId, t.id), inArray(table.id, part)));
    out.push(...ids.filter((id) => part.includes(id)).map((id) => rows.find((r) => r.id === id)?.name).filter((n): n is string => Boolean(n)));
  }
  return out;
}

async function listPromotions(c: Context<AppEnv>): Promise<Promotion[]> {
  const { db, d1, tenant: t } = c.var.auth;
  const rows = await db.select().from(promotions).where(eq(promotions.tenantId, t.id));
  // Uses and an estimate of the discount given (same formula as priceCart: % of the line).
  const { results } = await d1
    .prepare(
      `SELECT promotion_id, SUM(n) AS uses, SUM(given) AS given FROM (
         SELECT i.promotion_id, 1 AS n, ROUND(i.unit_price_cents * i.quantity / 1000.0 * p.percent_bps / 10000.0) AS given
         FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN promotions p ON p.id = i.promotion_id WHERE s.tenant_id = ?1 AND s.status = 'completed'
         UNION ALL
         SELECT i.promotion_id, 1, ROUND(i.unit_price_cents * i.quantity / 1000.0 * p.percent_bps / 10000.0)
         FROM order_items i JOIN orders o ON o.id = i.order_id JOIN promotions p ON p.id = i.promotion_id WHERE o.tenant_id = ?1 AND o.status <> 'cancelled'
       ) GROUP BY promotion_id`,
    )
    .bind(t.id)
    .all<{ promotion_id: string; uses: number; given: number }>();
  const out: Promotion[] = [];
  for (const r of rows) {
    const stats = results.find((x) => x.promotion_id === r.id);
    out.push({ ...toPromotionRule(r), targetNames: await namesFor(c, r.target, r.targetIds), uses: stats?.uses ?? 0, discountGivenCents: stats?.given ?? 0 });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es"));
}

async function listCoupons(c: Context<AppEnv>): Promise<Coupon[]> {
  const { db, d1, tenant: t } = c.var.auth;
  const rows = await db.select().from(coupons).where(eq(coupons.tenantId, t.id));
  const { results } = await d1
    .prepare(
      `SELECT coupon_code, SUM(total) AS total FROM (
         SELECT coupon_code, total_cents - refunded_cents AS total FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND coupon_code IS NOT NULL
         UNION ALL
         SELECT coupon_code, total_cents FROM orders WHERE tenant_id = ?1 AND status = 'completed' AND coupon_code IS NOT NULL
       ) GROUP BY coupon_code`,
    )
    .bind(t.id)
    .all<{ coupon_code: string; total: number }>();
  return rows
    .map((r) => ({ ...toCouponRule(r), id: r.id, description: r.description, salesCents: results.find((x) => x.coupon_code === r.code)?.total ?? 0 }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
}

export const promotionRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("promotions:read"), async (c) => c.json({ promotions: await listPromotions(c), coupons: await listCoupons(c) }))

  /** What the POS applies right now (promotions valid today for the register). */
  .get("/live", requirePermission("pos:sell"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const settings = await getSettings(c);
    return c.json(await livePromotions(db, t.id, businessDate(settings.timezone), "pos", { members: "all" }));
  })

  .post("/", requirePermission("promotions:write"), json(promotionSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const targetIds = input.target === "all" ? [] : [...new Set(input.targetIds)];
    const id = newId();
    await d1.batch([
      toStatement(d1, db.insert(promotions).values({ id, tenantId: t.id, ...input, targetIds })),
      toStatement(d1, auditEntry(c, { action: "promotion.create", entity: "promotion", entityId: id, after: { name: input.name, percentBps: input.percentBps } })),
    ]);
    return c.json((await listPromotions(c)).find((p) => p.id === id), 201);
  })

  .put("/:id", requirePermission("promotions:write"), json(promotionSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const id = c.req.param("id");
    const before = await db.select().from(promotions).where(and(eq(promotions.id, id), eq(promotions.tenantId, t.id))).get();
    if (!before) throw notFound("Promoción");
    const targetIds = input.target === "all" ? [] : [...new Set(input.targetIds)];
    await d1.batch([
      toStatement(d1, db.update(promotions).set({ ...input, targetIds, updatedAt: new Date().toISOString() }).where(and(eq(promotions.id, id), eq(promotions.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: "promotion.update", entity: "promotion", entityId: id, before: { name: before.name, percentBps: before.percentBps, active: before.active }, after: { name: input.name, percentBps: input.percentBps, active: input.active } })),
    ]);
    return c.json((await listPromotions(c)).find((p) => p.id === id));
  })

  .delete("/:id", requirePermission("promotions:write"), async (c) => {
    const { db, d1, tenant: t } = c.var.auth;
    const id = c.req.param("id");
    const before = await db.select().from(promotions).where(and(eq(promotions.id, id), eq(promotions.tenantId, t.id))).get();
    if (!before) throw notFound("Promoción");
    // Sales keep the promotion id; a used promotion is only deactivated so reports keep its name.
    const used = await d1.prepare("SELECT 1 FROM sale_items WHERE promotion_id = ?1 UNION SELECT 1 FROM order_items WHERE promotion_id = ?1 LIMIT 1").bind(id).first();
    await d1.batch([
      used
        ? toStatement(d1, db.update(promotions).set({ active: false, updatedAt: new Date().toISOString() }).where(eq(promotions.id, id)))
        : toStatement(d1, db.delete(promotions).where(eq(promotions.id, id))),
      toStatement(d1, auditEntry(c, { action: used ? "promotion.deactivate" : "promotion.delete", entity: "promotion", entityId: id, before: { name: before.name } })),
    ]);
    return c.json({ deleted: !used });
  })

  /* ---------- Coupons ---------- */
  .post("/coupons", requirePermission("promotions:write"), json(couponSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const exists = await db.select({ id: coupons.id }).from(coupons).where(and(eq(coupons.tenantId, t.id), eq(coupons.code, input.code))).get();
    if (exists) throw new AppError(409, "duplicate", "Ya existe un cupón con ese código", { code: "Ya existe" });
    const id = newId();
    await d1.batch([
      toStatement(d1, db.insert(coupons).values({ id, tenantId: t.id, ...input })),
      toStatement(d1, auditEntry(c, { action: "coupon.create", entity: "coupon", entityId: id, after: { code: input.code, kind: input.kind, value: input.value } })),
    ]);
    return c.json((await listCoupons(c)).find((x) => x.id === id), 201);
  })

  .put("/coupons/:id", requirePermission("promotions:write"), json(couponSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const id = c.req.param("id");
    const before = await db.select().from(coupons).where(and(eq(coupons.id, id), eq(coupons.tenantId, t.id))).get();
    if (!before) throw notFound("Cupón");
    const taken = await db.select({ id: coupons.id }).from(coupons).where(and(eq(coupons.tenantId, t.id), eq(coupons.code, input.code), ne(coupons.id, id))).get();
    if (taken) throw new AppError(409, "duplicate", "Ya existe un cupón con ese código", { code: "Ya existe" });
    if (input.maxUses !== null && input.maxUses < before.usesCount) {
      throw new AppError(422, "validation_error", "Revisa los campos marcados", { maxUses: `Ya se usó ${before.usesCount} veces` });
    }
    await d1.batch([
      toStatement(d1, db.update(coupons).set({ ...input, updatedAt: new Date().toISOString() }).where(and(eq(coupons.id, id), eq(coupons.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: "coupon.update", entity: "coupon", entityId: id, before: { code: before.code, active: before.active }, after: { code: input.code, active: input.active } })),
    ]);
    return c.json((await listCoupons(c)).find((x) => x.id === id));
  })

  /** Checks a code at the register before charging. */
  .get("/coupons/check/:code", requirePermission("pos:sell"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const settings = await getSettings(c);
    const coupon = await findCoupon(db, t.id, c.req.param("code"));
    const problem = coupon ? couponProblem(toCouponRule(coupon), businessDate(settings.timezone), "pos") : "Este cupón no existe.";
    if (problem) throw new AppError(422, "coupon_invalid", problem, { couponCode: problem });
    return c.json(toCouponRule(coupon!));
  });

