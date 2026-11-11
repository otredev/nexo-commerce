/**
 * Plan subscription (Stripe Billing) and the business's Stripe account for store payments (Connect).
 * Stripe is the source of truth: the webhook updates tenants.plan / plan_status.
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { checkoutPlanSchema, planOf, type BillingInfo, type PlanId, type StripeConnectStatus } from "@nexo/shared";
import type { AppEnv, Env } from "../env";
import { AppError } from "../lib/errors";
import { usageOf } from "../lib/plan";
import { stripe, stripeConfigured } from "../lib/stripe";
import { json } from "../lib/validate";
import { getSettings } from "../lib/sales";
import { requirePermission } from "../middleware/auth";

const appLink = (env: Env, path: string) => `${env.APP_URL.replace(/\/$/, "")}${path}`;
export const priceFor = (env: Env, plan: PlanId) => (plan === "pro" ? env.STRIPE_PRICE_PRO : plan === "business" ? env.STRIPE_PRICE_BUSINESS : undefined);
export const planForPrice = (env: Env, price: string | undefined): PlanId | null =>
  price && price === env.STRIPE_PRICE_PRO ? "pro" : price && price === env.STRIPE_PRICE_BUSINESS ? "business" : null;

async function tenantRow(env: Env, id: string) {
  const row = await controlDb(env.DB_CONTROL).select().from(control.tenants).where(eq(control.tenants.id, id)).get();
  if (!row) throw new AppError(404, "not_found", "Negocio no encontrado");
  return row;
}

export const billingRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("settings:read"), async (c) => {
    const { tenant: t, d1 } = c.var.auth;
    const row = await tenantRow(c.env, t.id);
    const body: BillingInfo = {
      plan: t.plan,
      planStatus: row.planStatus,
      periodEnd: row.planPeriodEnd,
      hasSubscription: Boolean(row.stripeSubscriptionId && row.planStatus !== "canceled"),
      billingAvailable: stripeConfigured(c.env) && Boolean(c.env.STRIPE_PRICE_PRO),
      usage: await usageOf(c.env, t.id, d1),
    };
    return c.json(body);
  })

  /** Stripe Checkout for a new subscription. With one already running, plan changes go through the portal. */
  .post("/checkout", requirePermission("billing:write"), json(checkoutPlanSchema), async (c) => {
    const { plan } = c.req.valid("json");
    const { tenant: t, user } = c.var.auth;
    const price = priceFor(c.env, plan);
    if (!stripeConfigured(c.env) || !price) throw new AppError(503, "stripe_not_configured", "La suscripción en línea aún no está disponible. Escríbenos para cambiar de plan.");
    const row = await tenantRow(c.env, t.id);
    if (row.stripeSubscriptionId && row.planStatus !== "canceled") {
      throw new AppError(409, "has_subscription", "Ya tienes una suscripción. Cambia de plan desde «Administrar suscripción».");
    }
    let customer = row.stripeCustomerId;
    if (!customer) {
      const created = await stripe<{ id: string }>(c.env, "POST", "/customers", { name: row.name, email: user.email, metadata: { tenant_id: t.id } }, { idempotencyKey: `customer-${t.id}` });
      customer = created.id;
      await controlDb(c.env.DB_CONTROL).update(control.tenants).set({ stripeCustomerId: customer }).where(eq(control.tenants.id, t.id));
    }
    const session = await stripe<{ url: string }>(c.env, "POST", "/checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: t.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { tenant_id: t.id } },
      metadata: { tenant_id: t.id },
      allow_promotion_codes: true,
      locale: "es",
      success_url: appLink(c.env, "/configuracion?tab=plan&pago=ok"),
      cancel_url: appLink(c.env, "/configuracion?tab=plan"),
    });
    return c.json({ url: session.url });
  })

  /** Stripe customer portal: card, invoices, plan change and cancellation. */
  .post("/portal", requirePermission("billing:write"), async (c) => {
    const row = await tenantRow(c.env, c.var.auth.tenant.id);
    if (!row.stripeCustomerId) throw new AppError(409, "no_customer", "Aún no tienes una suscripción.");
    const session = await stripe<{ url: string }>(c.env, "POST", "/billing_portal/sessions", { customer: row.stripeCustomerId, return_url: appLink(c.env, "/configuracion?tab=plan") });
    return c.json({ url: session.url });
  })

  /* ---------- Stripe Connect: the business receives its store's card payments ---------- */
  .get("/connect", requirePermission("settings:read"), async (c) => {
    const { tenant: t } = c.var.auth;
    let row = await tenantRow(c.env, t.id);
    // Coming back from onboarding: ask Stripe right away instead of waiting for the webhook.
    if (row.stripeAccountId && !row.stripeChargesEnabled && c.req.query("refresh") === "1" && stripeConfigured(c.env)) {
      const account = await stripe<{ charges_enabled: boolean }>(c.env, "GET", `/accounts/${row.stripeAccountId}`);
      if (account.charges_enabled) {
        await controlDb(c.env.DB_CONTROL).update(control.tenants).set({ stripeChargesEnabled: true }).where(eq(control.tenants.id, t.id));
        row = { ...row, stripeChargesEnabled: true };
      }
    }
    const body: StripeConnectStatus = {
      available: stripeConfigured(c.env),
      accountId: row.stripeAccountId,
      chargesEnabled: row.stripeChargesEnabled,
      planAllows: planOf(t.plan).limits.cardPayments,
    };
    return c.json(body);
  })

  /** Creates (once) the business's Stripe account and returns the onboarding link. */
  .post("/connect", requirePermission("billing:write"), async (c) => {
    const { tenant: t, user } = c.var.auth;
    if (!planOf(t.plan).limits.cardPayments) throw new AppError(402, "plan_feature", "El cobro con tarjeta está disponible desde el plan Pro.", { feature: "cardPayments" });
    const row = await tenantRow(c.env, t.id);
    let account = row.stripeAccountId;
    if (!account) {
      // The account's country follows the business's currency (USD → United States, MXN → Mexico…).
      const { currency } = await getSettings(c);
      const country = ({ USD: "US", MXN: "MX", CAD: "CA", COP: "CO", PEN: "PE", CLP: "CL", EUR: "ES", GTQ: "GT" } as Record<string, string>)[currency] ?? "MX";
      const created = await stripe<{ id: string }>(c.env, "POST", "/accounts", { type: "standard", country, email: user.email, business_profile: { name: row.name }, metadata: { tenant_id: t.id } }, { idempotencyKey: `account-${t.id}` });
      account = created.id;
      await controlDb(c.env.DB_CONTROL).update(control.tenants).set({ stripeAccountId: account }).where(eq(control.tenants.id, t.id));
    }
    const link = await stripe<{ url: string }>(c.env, "POST", "/account_links", {
      account,
      type: "account_onboarding",
      refresh_url: appLink(c.env, "/tienda?stripe=reintentar"),
      return_url: appLink(c.env, "/tienda?stripe=listo"),
    });
    return c.json({ url: link.url });
  });
