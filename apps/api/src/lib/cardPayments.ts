/**
 * Card payments of online-store orders through Stripe Checkout on the business's connected account.
 * The money goes to the business; the platform may keep an application fee (STRIPE_APPLICATION_FEE_BPS).
 * The order reserves stock when created; the session lasts 30 minutes and, if it expires unpaid,
 * the order is cancelled and the stock returns.
 */
import { eq } from "drizzle-orm";
import { control, controlDb, tenant as tenantSchema, type TenantDb } from "@nexo/db";
import type { Env, TenantRef } from "../env";
import { newId } from "./crypto";
import { cancelStatements, loadOrderRows, notifyOrder, orderLabel, sendOrderEmail, type OrderRow } from "./orders";
import { emitEvent, orderData } from "./outbound";
import { stripe } from "./stripe";
import { getTenantDb } from "./tenant";
import { toStatement } from "./inventory";

const SESSION_MINUTES = 30;

export interface CheckoutSession { id: string; url: string | null; status: "open" | "complete" | "expired"; payment_status: "paid" | "unpaid" | "no_payment_required"; payment_intent: string | null; metadata?: Record<string, string> }

export async function createOrderCheckout(env: Env, opts: { tenantId: string; account: string; order: OrderRow; storeName: string; currency: string; base: string }) {
  const { order } = opts;
  const feeBps = Number(env.STRIPE_APPLICATION_FEE_BPS ?? 0);
  const fee = feeBps > 0 ? Math.floor((order.totalCents * feeBps) / 10_000) : 0;
  const link = `${opts.base}/pedido/${order.token}`;
  return stripe<CheckoutSession>(
    env,
    "POST",
    "/checkout/sessions",
    {
      mode: "payment",
      // One line with the order total: the order already priced promotions, coupon, taxes and shipping.
      line_items: [{ quantity: 1, price_data: { currency: opts.currency.toLowerCase(), unit_amount: order.totalCents, product_data: { name: `Pedido ${orderLabel(order.number)} · ${opts.storeName}` } } }],
      customer_email: order.customerEmail ?? undefined,
      client_reference_id: order.id,
      metadata: { tenant_id: opts.tenantId, order_id: order.id },
      payment_intent_data: { metadata: { tenant_id: opts.tenantId, order_id: order.id }, ...(fee ? { application_fee_amount: fee } : {}) },
      success_url: `${link}?pago=ok`,
      cancel_url: `${link}?pago=cancelado`,
      expires_at: Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60 + 30,
      locale: "es",
    },
    { account: opts.account, idempotencyKey: `order-${order.id}` },
  );
}

/** Marks an order paid by card. Idempotent: a second call (webhook + return page) changes nothing. */
export async function markOrderPaid(db: TenantDb, d1: D1Database, tenantId: string, orderId: string, session: Pick<CheckoutSession, "id" | "payment_intent">) {
  const now = new Date().toISOString();
  const res = await d1.batch([
    d1
      .prepare(
        `UPDATE orders SET payment_status = 'paid', paid_method = 'card', paid_reference = ?1, paid_at = ?2, stripe_payment_intent_id = ?1, updated_at = ?2
         WHERE id = ?3 AND tenant_id = ?4 AND payment_status = 'pending' AND stripe_session_id = ?5`,
      )
      .bind(session.payment_intent, now, orderId, tenantId, session.id),
  ]);
  const changed = (res[0]?.meta.changes ?? 0) > 0;
  if (changed) {
    await d1.batch([
      toStatement(d1, db.insert(tenantSchema.auditLog).values({ id: newId(), tenantId, userId: null, userName: "Stripe", action: "order.paid", entity: "order", entityId: orderId, after: { method: "card", reference: session.payment_intent } })),
    ]);
  }
  return changed;
}

/** Order emails of a card order go out once it is paid. */
export async function notifyPaid(env: Env, db: TenantDb, ref: Pick<TenantRef, "id" | "slug" | "dbBinding">, orderId: string) {
  const rows = await loadOrderRows(db, ref.id, { id: orderId });
  if (!rows) return;
  await Promise.all([
    // Card orders reach the integrations once paid: created + paid.
    emitEvent(env, ref, "order.created", orderData(rows.order, rows.items)).then(() => emitEvent(env, ref, "order.paid", orderData(rows.order, rows.items))),
    sendOrderEmail(env, db, ref.id, ref.slug, "placed", rows.order, rows.items),
    sendOrderEmail(env, db, ref.id, ref.slug, "new_order", rows.order, rows.items),
    notifyOrder(env, db, ref.id, rows.order, "order_paid"),
  ]).catch((e) => console.error("[orders] email/push", e));
}

/** The checkout session expired without payment: cancel the order and return the stock. */
export async function expireCardOrder(env: Env, ref: TenantRef, orderId: string, sessionId: string) {
  const { db, d1 } = getTenantDb(env, ref);
  const rows = await loadOrderRows(db, ref.id, { id: orderId });
  if (!rows) return false;
  const o = rows.order;
  if (o.status !== "pending" || o.paymentStatus !== "pending" || o.paymentMethod !== "card" || o.stripeSessionId !== sessionId) return false;
  try {
    await d1.batch(cancelStatements(d1, db, { tenantId: ref.id, userId: null, userName: "Sistema" }, o, rows.items, { reason: "No se completó el pago con tarjeta", by: "system", from: ["pending"] }));
  } catch (err) {
    if (/NOT NULL constraint failed/i.test(String((err as Error).message))) return false;
    throw err;
  }
  const after = await loadOrderRows(db, ref.id, { id: orderId });
  if (after) await sendOrderEmail(env, db, ref.id, ref.slug, "cancelled", after.order, after.items).catch(() => {});
  return true;
}

/** Stripe state of the business: card payments only work once Stripe enabled charges on its account. */
export async function tenantStripe(env: Env, tenantId: string) {
  return controlDb(env.DB_CONTROL)
    .select({ accountId: control.tenants.stripeAccountId, chargesEnabled: control.tenants.stripeChargesEnabled, plan: control.tenants.plan, planStatus: control.tenants.planStatus })
    .from(control.tenants)
    .where(eq(control.tenants.id, tenantId))
    .get();
}
