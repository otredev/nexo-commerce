/**
 * Server side of promotions, coupons and customer matching. Pricing itself is the shared
 * priceCart(), so the POS, the store and the server always agree.
 */
import { and, eq, or } from "drizzle-orm";
import { tenant, type TenantDb } from "@nexo/db";
import { isLive, normalizeCode, normalizeSearch, type Channel, type CouponRule, type PromotionRule } from "@nexo/shared";
import { newId } from "./crypto";
import { toStatement } from "./inventory";

const { promotions, coupons, customers } = tenant;

export const toPromotionRule = (p: typeof promotions.$inferSelect): PromotionRule => ({
  id: p.id, name: p.name, percentBps: p.percentBps, target: p.target, targetIds: p.targetIds, channel: p.channel, startsOn: p.startsOn, endsOn: p.endsOn, active: p.active,
});
export const toCouponRule = (c: typeof coupons.$inferSelect): CouponRule => ({
  code: c.code, kind: c.kind, value: c.value, minSubtotalCents: c.minSubtotalCents, maxUses: c.maxUses, usesCount: c.usesCount, channel: c.channel, startsOn: c.startsOn, endsOn: c.endsOn, active: c.active,
});

/** Promotions valid today for a channel. */
export async function livePromotions(db: TenantDb, tenantId: string, today: string, channel: Channel): Promise<PromotionRule[]> {
  const rows = await db.select().from(promotions).where(and(eq(promotions.tenantId, tenantId), eq(promotions.active, true)));
  return rows.map(toPromotionRule).filter((p) => isLive(p, today, channel));
}

export async function findCoupon(db: TenantDb, tenantId: string, code: string) {
  return db.select().from(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, normalizeCode(code)))).get();
}

/**
 * Counts one use of a coupon in the same batch as the sale or order. The CHECK
 * (uses_count <= max_uses) fails the batch if the last use was taken meanwhile.
 */
export const couponUseStatement = (d1: D1Database, couponId: string) =>
  d1.prepare("UPDATE coupons SET uses_count = uses_count + 1, updated_at = ?2 WHERE id = ?1").bind(couponId, new Date().toISOString());

/* ---------- Customers ---------- */

export const normalizePhone = (phone: string | null | undefined) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
};
export const normalizeEmail = (email: string | null | undefined) => (email?.trim() ? email.trim().toLowerCase() : null);
export const customerSearchText = (c: { name: string; email: string | null; phone: string | null; taxId: string | null }) =>
  normalizeSearch([c.name, c.email, c.phone, c.taxId].filter(Boolean).join(" "));

/** Existing customer with this email or phone (email wins). */
export async function matchCustomer(db: TenantDb, tenantId: string, email: string | null, phone: string | null) {
  const conds = [email ? eq(customers.email, email) : undefined, phone ? eq(customers.phone, phone) : undefined].filter(Boolean);
  if (!conds.length) return null;
  const rows = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.archived, false), or(...conds)));
  return rows.find((r) => email && r.email === email) ?? rows[0] ?? null;
}

/** Customer id for an online order: the matching record, or a new one created in the same batch. */
export async function customerForOrder(d1: D1Database, db: TenantDb, tenantId: string, input: { name: string; email: string; phone: string }) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const found = await matchCustomer(db, tenantId, email, phone);
  if (found) return { id: found.id, statements: [] as D1PreparedStatement[] };
  const id = newId();
  const row = { name: input.name, email, phone, taxId: null };
  return {
    id,
    statements: [toStatement(d1, db.insert(customers).values({ id, tenantId, ...row, source: "online", searchText: customerSearchText(row) }))],
  };
}
