import { and, asc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { tenant } from "@nexo/db";
import { fromMilli, type CashSessionTotals, type SaleDetail, type UnitCode } from "@nexo/shared";
import type { AppEnv } from "../env";
import { notFound } from "./errors";

const { sales, saleItems, salePayments, saleReturns, saleReturnItems, cashSessions, locations, businessSettings } = tenant;

export async function getSettings(c: Context<AppEnv>) {
  const { db, tenant: t } = c.var.auth;
  const s = await db.select().from(businessSettings).where(eq(businessSettings.tenantId, t.id)).get();
  if (!s) throw notFound("Configuración");
  return s;
}

export async function loadSale(c: Context<AppEnv>, id: string): Promise<SaleDetail | null> {
  const { db, tenant: t } = c.var.auth;
  const sale = await db.select().from(sales).where(and(eq(sales.id, id), eq(sales.tenantId, t.id))).get();
  if (!sale) return null;
  const [items, payments, returns, location, session] = await Promise.all([
    db.select().from(saleItems).where(eq(saleItems.saleId, id)).orderBy(asc(saleItems.position)),
    db.select().from(salePayments).where(eq(salePayments.saleId, id)),
    db.select().from(saleReturns).where(eq(saleReturns.saleId, id)).orderBy(asc(saleReturns.createdAt)),
    db.select({ name: locations.name }).from(locations).where(eq(locations.id, sale.locationId)).get(),
    db.select({ status: cashSessions.status }).from(cashSessions).where(eq(cashSessions.id, sale.sessionId)).get(),
  ]);
  const returnItems = returns.length
    ? await db.select().from(saleReturnItems).where(inArray(saleReturnItems.returnId, returns.map((r) => r.id)))
    : [];
  return {
    id: sale.id,
    number: sale.number,
    status: sale.status,
    createdAt: sale.createdAt,
    businessDate: sale.businessDate,
    locationId: sale.locationId,
    locationName: location?.name ?? "—",
    sessionId: sale.sessionId,
    userName: sale.userName,
    customerName: sale.customerName,
    customerContact: sale.customerContact,
    note: sale.note,
    subtotalCents: sale.subtotalCents,
    discountCents: sale.discountCents,
    taxCents: sale.taxCents,
    totalCents: sale.totalCents,
    paidCents: sale.paidCents,
    changeCents: sale.changeCents,
    pricesIncludeTax: sale.pricesIncludeTax,
    refundedCents: sale.refundedCents,
    voidedAt: sale.voidedAt,
    voidedBy: sale.voidedBy,
    voidReason: sale.voidReason,
    voidable: sale.status === "completed" && sale.refundedCents === 0 && returns.length === 0 && session?.status === "open",
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productId: i.productId,
      name: i.name,
      options: i.options,
      sku: i.sku,
      unit: i.unit as UnitCode,
      quantity: fromMilli(i.quantity),
      unitPriceCents: i.unitPriceCents,
      discountCents: i.discountCents,
      taxRateBps: i.taxRateBps,
      taxCents: i.taxCents,
      totalCents: i.totalCents,
      returnedQuantity: fromMilli(i.returnedQuantity),
    })),
    payments: payments.map((p) => ({ method: p.method, amountCents: p.amountCents, reference: p.reference })),
    returns: returns.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      userName: r.userName,
      refundMethod: r.refundMethod,
      refundCents: r.refundCents,
      restock: r.restock,
      reason: r.reason,
      items: returnItems.filter((x) => x.returnId === r.id).map((x) => ({ saleItemId: x.saleItemId, quantity: fromMilli(x.quantity), refundCents: x.refundCents })),
    })),
  };
}

/**
 * Live totals of a cash session. Expected cash in the drawer =
 *   opening float + cash received from completed sales (minus change) + cash in − cash out − cash refunds.
 */
export async function sessionTotals(d1: D1Database, tenantId: string, sessionId: string, openingCashCents: number): Promise<CashSessionTotals> {
  const [salesRow, methods, moves, refunds] = await d1.batch([
    d1
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS total, COALESCE(SUM(change_cents), 0) AS change FROM sales WHERE tenant_id = ?1 AND session_id = ?2 AND status = 'completed'")
      .bind(tenantId, sessionId),
    d1
      .prepare(
        `SELECT p.method, SUM(p.amount_cents) AS amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.tenant_id = ?1 AND s.session_id = ?2 AND s.status = 'completed' GROUP BY p.method`,
      )
      .bind(tenantId, sessionId),
    d1
      .prepare("SELECT type, COALESCE(SUM(amount_cents), 0) AS amount FROM cash_movements WHERE tenant_id = ?1 AND session_id = ?2 GROUP BY type")
      .bind(tenantId, sessionId),
    d1
      .prepare("SELECT COALESCE(SUM(refund_cents), 0) AS amount FROM sale_returns WHERE tenant_id = ?1 AND session_id = ?2 AND refund_method = 'cash'")
      .bind(tenantId, sessionId),
  ]);
  const s = salesRow!.results[0] as { n: number; total: number; change: number };
  const byMethod: Record<string, number> = {};
  for (const r of methods!.results as Array<{ method: string; amount: number }>) byMethod[r.method] = r.amount;
  if (byMethod.cash !== undefined) byMethod.cash -= s.change;
  const move = Object.fromEntries((moves!.results as Array<{ type: string; amount: number }>).map((r) => [r.type, r.amount]));
  const cashSales = byMethod.cash ?? 0;
  const cashIn = move.in ?? 0;
  const cashOut = move.out ?? 0;
  const cashRefunds = (refunds!.results[0] as { amount: number }).amount;
  return {
    openingCashCents,
    salesCount: s.n,
    salesTotalCents: s.total,
    byMethod,
    cashSalesCents: cashSales,
    cashInCents: cashIn,
    cashOutCents: cashOut,
    cashRefundsCents: cashRefunds,
    expectedCashCents: openingCashCents + cashSales + cashIn - cashOut - cashRefunds,
  };
}

export async function openSessionFor(c: Context<AppEnv>, locationId: string) {
  const { db, tenant: t } = c.var.auth;
  return db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.tenantId, t.id), eq(cashSessions.locationId, locationId), eq(cashSessions.status, "open")))
    .get();
}

/** UPSERT statements that keep the per-day summaries in sync. Values may be negative (voids, returns). */
export function dailySalesUpsert(
  d1: D1Database,
  v: { tenantId: string; date: string; locationId: string; count: number; total: number; discount: number; tax: number; cost: number; returns: number; voided: number },
) {
  return d1
    .prepare(
      `INSERT INTO daily_sales (tenant_id, date, location_id, sales_count, total_cents, discount_cents, tax_cents, cost_cents, returns_cents, voided_count)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(tenant_id, date, location_id) DO UPDATE SET
         sales_count = sales_count + excluded.sales_count, total_cents = total_cents + excluded.total_cents,
         discount_cents = discount_cents + excluded.discount_cents, tax_cents = tax_cents + excluded.tax_cents,
         cost_cents = cost_cents + excluded.cost_cents, returns_cents = returns_cents + excluded.returns_cents,
         voided_count = voided_count + excluded.voided_count`,
    )
    .bind(v.tenantId, v.date, v.locationId, v.count, v.total, v.discount, v.tax, v.cost, v.returns, v.voided);
}

export function dailyProductUpsert(d1: D1Database, v: { tenantId: string; date: string; variantId: string; productId: string; quantity: number; total: number; cost: number }) {
  return d1
    .prepare(
      `INSERT INTO daily_product_sales (tenant_id, date, variant_id, product_id, quantity, total_cents, cost_cents)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(tenant_id, date, variant_id) DO UPDATE SET
         quantity = quantity + excluded.quantity, total_cents = total_cents + excluded.total_cents, cost_cents = cost_cents + excluded.cost_cents`,
    )
    .bind(v.tenantId, v.date, v.variantId, v.productId, v.quantity, v.total, v.cost);
}
