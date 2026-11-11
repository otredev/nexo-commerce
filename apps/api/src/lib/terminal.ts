/**
 * Stripe Terminal on the business's connected account (Phase 12): Tap to Pay on the customer display.
 * Direct charges (Stripe-Account header): the money goes to the business, the platform may keep
 * STRIPE_APPLICATION_FEE_BPS. The server is the only one that decides whether a card was paid.
 */
import { effectivePlan, planOf, declineMessage, type TerminalPayment } from "@nexo/shared";
import type { Env } from "../env";
import { tenantStripe } from "./cardPayments";
import { AppError } from "./errors";
import { stripe, stripeConfigured } from "./stripe";

export interface StripePaymentIntent {
  id: string;
  client_secret: string;
  amount: number;
  amount_received?: number;
  currency: string;
  status: "requires_payment_method" | "requires_confirmation" | "requires_action" | "processing" | "requires_capture" | "canceled" | "succeeded";
  last_payment_error?: { code?: string; decline_code?: string; message?: string } | null;
  metadata?: Record<string, string>;
}

/** The business's Stripe account if it can charge cards at the register, or why not. */
export async function terminalAccount(env: Env, tenantId: string): Promise<{ account: string | null; reason: string | null }> {
  if (!stripeConfigured(env)) return { account: null, reason: "Los pagos con Stripe aún no están configurados en la plataforma." };
  const t = await tenantStripe(env, tenantId);
  if (!t) return { account: null, reason: "Negocio no encontrado." };
  if (!planOf(effectivePlan(t.plan, t.planStatus)).limits.cardPayments) return { account: null, reason: "El cobro con tarjeta está disponible desde el plan Pro." };
  if (!t.accountId) return { account: null, reason: "Conecta tu cuenta de Stripe en Tienda en línea › Formas de pago." };
  if (!t.chargesEnabled) return { account: null, reason: "Stripe aún no habilita cobros en tu cuenta. Termina el registro en Stripe." };
  return { account: t.accountId, reason: null };
}

export async function requireTerminalAccount(env: Env, tenantId: string) {
  const r = await terminalAccount(env, tenantId);
  if (!r.account) throw new AppError(409, "card_unavailable", r.reason ?? "El cobro con tarjeta no está disponible.");
  return r.account;
}

export function toTerminalPayment(pi: StripePaymentIntent): TerminalPayment {
  const failed = pi.status === "requires_payment_method" && Boolean(pi.last_payment_error);
  const status = pi.status === "succeeded" ? "succeeded"
    : pi.status === "canceled" ? "canceled"
    : failed ? "failed"
    : pi.status === "requires_payment_method" ? "waiting"
    : "processing";
  return {
    id: pi.id,
    clientSecret: pi.client_secret,
    amountCents: pi.amount,
    currency: pi.currency.toUpperCase(),
    status,
    error: failed ? declineMessage(pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code) : null,
  };
}

export async function createTerminalPayment(env: Env, opts: { tenantId: string; account: string; amountCents: number; currency: string; clientId: string; locationId: string; description: string }) {
  const feeBps = Number(env.STRIPE_APPLICATION_FEE_BPS ?? 0);
  const fee = feeBps > 0 ? Math.floor((opts.amountCents * feeBps) / 10_000) : 0;
  return stripe<StripePaymentIntent>(
    env,
    "POST",
    "/payment_intents",
    {
      amount: opts.amountCents,
      currency: opts.currency.toLowerCase(),
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      description: opts.description,
      metadata: { tenant_id: opts.tenantId, client_id: opts.clientId, location_id: opts.locationId, source: "pos" },
      ...(fee ? { application_fee_amount: fee } : {}),
    },
    // Same sale, same amount → same PaymentIntent (a retry never charges twice).
    { account: opts.account, idempotencyKey: `pos-${opts.tenantId}-${opts.clientId}-${opts.amountCents}` },
  );
}

export const getTerminalPayment = (env: Env, account: string, id: string) => stripe<StripePaymentIntent>(env, "GET", `/payment_intents/${encodeURIComponent(id)}`, undefined, { account });

/**
 * Before a sale with a card charge is saved: the PaymentIntent belongs to this business, succeeded, is
 * for this amount and currency, and was made for this sale.
 */
export async function verifyTerminalPayment(env: Env, opts: { tenantId: string; id: string; amountCents: number; currency: string; clientId: string }) {
  const account = await requireTerminalAccount(env, opts.tenantId);
  const pi = await getTerminalPayment(env, account, opts.id);
  const ok = pi.status === "succeeded"
    && pi.metadata?.tenant_id === opts.tenantId
    && pi.metadata?.client_id === opts.clientId
    && (pi.amount_received ?? pi.amount) === opts.amountCents
    && pi.currency.toUpperCase() === opts.currency.toUpperCase();
  if (!ok) throw new AppError(422, "card_not_paid", pi.status === "succeeded" ? "El cobro con tarjeta no coincide con esta venta." : "El cobro con tarjeta no se completó.");
  return pi;
}
