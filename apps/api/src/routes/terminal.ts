/** Card payments at the register with Stripe Terminal (Tap to Pay on the customer display). */
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { tenant } from "@nexo/db";
import { terminalLocationSchema, terminalPaymentCreateSchema, type TerminalStatus } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { AppError, notFound } from "../lib/errors";
import { getSettings } from "../lib/sales";
import { stripe } from "../lib/stripe";
import { createTerminalPayment, getTerminalPayment, requireTerminalAccount, terminalAccount, toTerminalPayment, type StripePaymentIntent } from "../lib/terminal";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { locations, salePayments } = tenant;

export const terminalRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("pos:sell"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const [acct, locs] = await Promise.all([terminalAccount(c.env, t.id), db.select().from(locations).where(and(eq(locations.tenantId, t.id), eq(locations.active, true)))]);
    const body: TerminalStatus = {
      available: Boolean(acct.account),
      reason: acct.reason,
      locations: locs.filter((l) => l.type === "store").map((l) => ({ id: l.id, name: l.name, terminalLocationId: l.stripeTerminalLocationId })),
    };
    return c.json(body);
  })

  /** Registers a store with Stripe Terminal (its address is required by Stripe), once. */
  .post("/locations/:id", requirePermission("settings:write"), json(terminalLocationSchema), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const account = await requireTerminalAccount(c.env, t.id);
    const loc = await db.select().from(locations).where(and(eq(locations.id, c.req.param("id")), eq(locations.tenantId, t.id))).get();
    if (!loc) throw notFound("Ubicación");
    const a = c.req.valid("json");
    const created = await stripe<{ id: string }>(
      c.env,
      "POST",
      "/terminal/locations",
      { display_name: loc.name.slice(0, 100), address: { line1: a.line1, city: a.city, state: a.state || undefined, postal_code: a.postalCode, country: a.country }, metadata: { tenant_id: t.id, location_id: loc.id } },
      { account, idempotencyKey: `tml-${t.id}-${loc.id}-${loc.stripeTerminalLocationId ?? "new"}` },
    );
    await db.batch([
      db.update(locations).set({ stripeTerminalLocationId: created.id }).where(eq(locations.id, loc.id)),
      auditEntry(c, { action: "terminal.location", entity: "location", entityId: loc.id, after: { stripeTerminalLocationId: created.id } }),
    ]);
    return c.json({ id: loc.id, name: loc.name, terminalLocationId: created.id });
  })

  /** A card charge for the customer display to collect. */
  .post("/payments", requirePermission("pos:sell"), json(terminalPaymentCreateSchema), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const input = c.req.valid("json");
    const account = await requireTerminalAccount(c.env, t.id);
    const loc = await db.select().from(locations).where(and(eq(locations.id, input.locationId), eq(locations.tenantId, t.id))).get();
    if (!loc) throw notFound("Ubicación");
    if (!loc.stripeTerminalLocationId) throw new AppError(409, "terminal_location_missing", `Activa el cobro con tarjeta para «${loc.name}» en Configuración › Integraciones.`);
    const s = await getSettings(c);
    const pi = await createTerminalPayment(c.env, { tenantId: t.id, account, amountCents: input.amountCents, currency: s.currency, clientId: input.clientId, locationId: loc.id, description: `${s.tradeName} · ${loc.name}` });
    return c.json(toTerminalPayment(pi), 201);
  })

  .get("/payments/:id", requirePermission("pos:sell"), async (c) => {
    const { tenant: t } = c.var.auth;
    const account = await requireTerminalAccount(c.env, t.id);
    const pi = await getTerminalPayment(c.env, account, c.req.param("id"));
    if (pi.metadata?.tenant_id !== t.id) throw notFound("Cobro");
    c.header("Cache-Control", "no-store");
    return c.json(toTerminalPayment(pi));
  })

  /** Stops waiting for the card (only while not paid). */
  .post("/payments/:id/cancel", requirePermission("pos:sell"), async (c) => {
    const { tenant: t } = c.var.auth;
    const account = await requireTerminalAccount(c.env, t.id);
    const pi = await getTerminalPayment(c.env, account, c.req.param("id"));
    if (pi.metadata?.tenant_id !== t.id) throw notFound("Cobro");
    if (pi.status === "succeeded") throw new AppError(409, "card_already_paid", "Este cobro ya se pagó; termina la venta.");
    if (pi.status === "canceled") return c.json(toTerminalPayment(pi));
    const canceled = await stripe<StripePaymentIntent>(c.env, "POST", `/payment_intents/${encodeURIComponent(pi.id)}/cancel`, {}, { account });
    return c.json(toTerminalPayment(canceled));
  })

  /** A card that was charged but whose sale could not be saved: give the money back (only if no sale uses it). */
  .post("/payments/:id/refund", requirePermission("pos:sell"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const account = await requireTerminalAccount(c.env, t.id);
    const pi = await getTerminalPayment(c.env, account, c.req.param("id"));
    if (pi.metadata?.tenant_id !== t.id) throw notFound("Cobro");
    const used = await db.select({ id: salePayments.id }).from(salePayments).where(and(eq(salePayments.tenantId, t.id), eq(salePayments.stripePaymentIntentId, pi.id))).get();
    if (used) throw new AppError(409, "card_in_sale", "Este cobro ya es parte de una venta: devuélvelo desde la venta.");
    if (pi.status !== "succeeded") throw new AppError(409, "card_not_paid", "Este cobro no se completó; no hay nada que reembolsar.");
    await stripe(c.env, "POST", "/refunds", { payment_intent: pi.id, ...(Number(c.env.STRIPE_APPLICATION_FEE_BPS ?? 0) > 0 ? { refund_application_fee: true } : {}) }, { account, idempotencyKey: `refund-${pi.id}` });
    await db.batch([auditEntry(c, { action: "terminal.refund", entity: "payment_intent", entityId: pi.id, after: { amountCents: pi.amount } })]);
    return c.body(null, 204);
  });
