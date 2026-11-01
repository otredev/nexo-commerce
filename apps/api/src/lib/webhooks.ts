/**
 * Stripe webhooks. One endpoint receives both platform events (subscriptions) and Connect events
 * (the businesses' accounts: store payments, onboarding). Each event is applied once (stripe_events).
 */
import { eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import type { Env, TenantRef } from "../env";
import { expireCardOrder, markOrderPaid, notifyPaid, type CheckoutSession } from "./cardPayments";
import { stripe } from "./stripe";
import { getTenantDb } from "./tenant";
import { planForPrice } from "../routes/billing";

export interface StripeEvent { id: string; type: string; account?: string; data: { object: Record<string, unknown> } }

interface Subscription {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data: Array<{ price: { id: string }; current_period_end?: number }> };
}

const PLAN_STATUS: Record<string, "active" | "trialing" | "past_due" | "canceled"> = {
  active: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", incomplete: "past_due", paused: "past_due",
  canceled: "canceled", incomplete_expired: "canceled",
};

async function findTenant(env: Env, by: { id?: string | null; customer?: string | null; account?: string | null }) {
  const db = controlDb(env.DB_CONTROL);
  const t = control.tenants;
  const where = by.id ? eq(t.id, by.id) : by.customer ? eq(t.stripeCustomerId, by.customer) : by.account ? eq(t.stripeAccountId, by.account) : null;
  return where ? db.select().from(t).where(where).get() : undefined;
}

export async function applySubscription(env: Env, sub: Subscription) {
  const tenant = await findTenant(env, { id: sub.metadata?.tenant_id }) ?? (await findTenant(env, { customer: sub.customer }));
  if (!tenant) return console.warn("[stripe] subscription without tenant", sub.id);
  const status = PLAN_STATUS[sub.status] ?? "past_due";
  const item = sub.items?.data[0];
  const plan = status === "canceled" ? "free" : (planForPrice(env, item?.price.id) ?? tenant.plan);
  const end = item?.current_period_end ?? sub.current_period_end;
  await controlDb(env.DB_CONTROL)
    .update(control.tenants)
    .set({
      plan,
      planStatus: status,
      planPeriodEnd: end ? new Date(end * 1000).toISOString() : null,
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: status === "canceled" ? null : sub.id,
    })
    .where(eq(control.tenants.id, tenant.id));
}

async function handle(env: Env, event: StripeEvent) {
  const obj = event.data.object;
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return applySubscription(env, obj as unknown as Subscription);

    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = obj as unknown as CheckoutSession & { mode: string; subscription?: string };
      if (s.mode === "subscription" && s.subscription) {
        // The subscription events also arrive; reading it here makes the upgrade visible immediately.
        return applySubscription(env, await stripe<Subscription>(env, "GET", `/subscriptions/${s.subscription}`));
      }
      if (s.mode === "payment" && s.payment_status === "paid") return orderSession(env, event.account, s, "paid");
      return;
    }
    case "checkout.session.expired": {
      const s = obj as unknown as CheckoutSession & { mode: string };
      if (s.mode === "payment") return orderSession(env, event.account, s, "expired");
      return;
    }
    case "account.updated": {
      const a = obj as { id: string; charges_enabled?: boolean };
      const tenant = await findTenant(env, { account: a.id });
      if (tenant) await controlDb(env.DB_CONTROL).update(control.tenants).set({ stripeChargesEnabled: Boolean(a.charges_enabled) }).where(eq(control.tenants.id, tenant.id));
      return;
    }
    case "account.application.deauthorized": {
      if (!event.account) return;
      const tenant = await findTenant(env, { account: event.account });
      if (tenant) await controlDb(env.DB_CONTROL).update(control.tenants).set({ stripeAccountId: null, stripeChargesEnabled: false }).where(eq(control.tenants.id, tenant.id));
      return;
    }
  }
}

/** A store order's checkout session, coming from the business's connected account. */
async function orderSession(env: Env, account: string | undefined, s: CheckoutSession, what: "paid" | "expired") {
  const tenantId = s.metadata?.tenant_id;
  const orderId = s.metadata?.order_id;
  if (!tenantId || !orderId) return;
  const tenant = await findTenant(env, { id: tenantId });
  // The event must come from the account of that same business.
  if (!tenant || !account || tenant.stripeAccountId !== account) return console.warn("[stripe] order session from unexpected account", s.id);
  const ref: TenantRef = { id: tenant.id, slug: tenant.slug, name: tenant.name, dbBinding: tenant.dbBinding };
  if (what === "expired") return void (await expireCardOrder(env, ref, orderId, s.id));
  const { db, d1 } = getTenantDb(env, ref);
  if (await markOrderPaid(db, d1, tenant.id, orderId, s)) await notifyPaid(env, db, ref, orderId);
}

/** Applies an event once. Returns false when it had already been processed. */
export async function processStripeEvent(env: Env, event: StripeEvent) {
  const seen = await env.DB_CONTROL.prepare("SELECT 1 AS ok FROM stripe_events WHERE id = ?1").bind(event.id).first();
  if (seen) return false;
  await handle(env, event);
  // Recorded after success: if handling fails, Stripe retries and every handler is idempotent.
  await env.DB_CONTROL.prepare("INSERT INTO stripe_events (id, type) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING").bind(event.id, event.type).run();
  return true;
}
