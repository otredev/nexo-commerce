/**
 * Outgoing webhooks (Phase 11). Each event becomes one delivery per subscribed endpoint, stored in the
 * business's D1 and POSTed right away; failures are retried by the hourly job with backoff
 * (1 min, 10 min, 1 h, 6 h, 24 h → in practice on the next hourly runs) and then given up.
 *
 * Request: POST <url>, JSON body WebhookPayload, headers
 *   Nexo-Event: <type>   Nexo-Delivery: <delivery id>   Nexo-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 * Any 2xx answer is success. 10-second timeout.
 */
import type { Context } from "hono";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { control, controlDb, tenant, tenantDb, type TenantDb } from "@nexo/db";
import {
  fromMilli, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_MINUTES,
  type WebhookDelivery, type WebhookEndpoint, type WebhookEventType, type WebhookPayload,
} from "@nexo/shared";
import type { AppEnv, Env, TenantRef } from "../env";
import { newId, randomToken } from "./crypto";
import { getTenantD1 } from "./tenant";
import type { OrderItemRow, OrderRow } from "./orders";

const { webhookEndpoints, webhookDeliveries } = tenant;
type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export const newWebhookSecret = () => `whsec_${randomToken(24)}`;

export const toEndpoint = (r: EndpointRow): WebhookEndpoint => ({
  id: r.id, url: r.url, description: r.description, events: r.events as WebhookEventType[], active: r.active, secret: r.secret,
  createdAt: r.createdAt, lastSuccessAt: r.lastSuccessAt, failures: r.failures,
});
export const toDelivery = (r: DeliveryRow): WebhookDelivery => ({
  id: r.id, endpointId: r.endpointId, eventId: r.eventId, type: r.type, status: r.status, attempts: r.attempts, lastStatus: r.lastStatus,
  lastError: r.lastError, nextAttemptAt: r.nextAttemptAt, createdAt: r.createdAt, deliveredAt: r.deliveredAt,
});

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `t=${t},v1=${hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`)))}`;
}

/** Sends one delivery and records the outcome (attempts, next retry, endpoint health). */
export async function attemptDelivery(d1: D1Database, delivery: DeliveryRow, endpoint: EndpointRow): Promise<boolean> {
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Nexo-Webhooks/1.0",
        "nexo-event": delivery.type,
        "nexo-delivery": delivery.id,
        "nexo-signature": await signWebhook(endpoint.secret, delivery.payload),
      },
      body: delivery.payload,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (!res.ok) error = (await res.text().catch(() => "")).slice(0, 300) || `HTTP ${res.status}`;
    else await res.body?.cancel().catch(() => {});
  } catch (err) {
    error = String((err as Error)?.message ?? err).slice(0, 300);
  }
  const now = new Date();
  const attempts = delivery.attempts + 1;
  const ok = status !== null && status >= 200 && status < 300;
  if (ok) {
    await d1.batch([
      d1.prepare("UPDATE webhook_deliveries SET status = 'succeeded', attempts = ?2, last_status = ?3, last_error = NULL, next_attempt_at = NULL, delivered_at = ?4 WHERE id = ?1").bind(delivery.id, attempts, status, now.toISOString()),
      d1.prepare("UPDATE webhook_endpoints SET failures = 0, last_success_at = ?2 WHERE id = ?1").bind(endpoint.id, now.toISOString()),
    ]);
  } else {
    const wait = WEBHOOK_RETRY_MINUTES[attempts - 1];
    const giveUp = attempts >= WEBHOOK_MAX_ATTEMPTS || wait === undefined;
    await d1.batch([
      d1.prepare("UPDATE webhook_deliveries SET status = ?2, attempts = ?3, last_status = ?4, last_error = ?5, next_attempt_at = ?6 WHERE id = ?1")
        .bind(delivery.id, giveUp ? "failed" : "pending", attempts, status, error, giveUp ? null : new Date(now.getTime() + wait! * 60_000).toISOString()),
      d1.prepare("UPDATE webhook_endpoints SET failures = failures + 1 WHERE id = ?1").bind(endpoint.id),
    ]);
  }
  return ok;
}

/** Queues an event for every active endpoint subscribed to it and tries to deliver now. */
export async function emitEvent(env: Env, t: Pick<TenantRef, "id" | "slug" | "dbBinding">, type: WebhookEventType | "ping", data: unknown, only?: string) {
  let d1: D1Database;
  try { d1 = getTenantD1(env, t); } catch { return 0; }
  const db = tenantDb(d1);
  const endpoints = (await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.tenantId, t.id), only ? eq(webhookEndpoints.id, only) : eq(webhookEndpoints.active, true))))
    .filter((e) => only || type === "ping" || !e.events.length || e.events.includes(type));
  if (!endpoints.length) return 0;
  const eventId = `evt_${newId()}`;
  const payload: WebhookPayload = { id: eventId, type, created: new Date().toISOString(), business: { id: t.id, slug: t.slug }, data };
  const body = JSON.stringify(payload);
  const rows: DeliveryRow[] = endpoints.map((e) => ({
    id: `whd_${newId()}`, tenantId: t.id, endpointId: e.id, eventId, type, payload: body, status: "pending", attempts: 0,
    lastStatus: null, lastError: null, nextAttemptAt: new Date().toISOString(), createdAt: new Date().toISOString(), deliveredAt: null,
  }));
  await d1.batch(rows.map((r) => d1.prepare(
    "INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, event_id, type, payload, status, attempts, next_attempt_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, ?8)",
  ).bind(r.id, r.tenantId, r.endpointId, r.eventId, r.type, r.payload, r.nextAttemptAt, r.createdAt)));
  const results = await Promise.all(rows.map((r) => attemptDelivery(d1, r, endpoints.find((e) => e.id === r.endpointId)!).catch(() => false)));
  return results.filter(Boolean).length;
}

/** From a route: runs after the response, never fails the request. */
export function emitFrom(c: Context<AppEnv>, type: WebhookEventType, data: unknown) {
  const t = c.var.auth.tenant;
  const p = emitEvent(c.env, t, type, data).catch((err) => console.error("[webhooks] emit", type, err));
  try { c.executionCtx.waitUntil(p); } catch { /* tests without an execution context */ }
}

/** Hourly: retries due deliveries of every business and drops logs older than 30 days. */
export async function retryWebhooks(env: Env, now = new Date()) {
  const tenants = await controlDb(env.DB_CONTROL)
    .select({ id: control.tenants.id, slug: control.tenants.slug, dbBinding: control.tenants.dbBinding })
    .from(control.tenants)
    .where(eq(control.tenants.status, "active"));
  const seen = new Set<string>();
  let retried = 0;
  for (const t of tenants) {
    let d1: D1Database;
    try { d1 = getTenantD1(env, t); } catch { continue; }
    // One pass per database is enough: the due list is per database, filtered by tenant.
    if (!seen.has(t.dbBinding)) {
      seen.add(t.dbBinding);
      await d1.prepare("DELETE FROM webhook_deliveries WHERE created_at < ?1").bind(new Date(now.getTime() - 30 * 86_400_000).toISOString()).run().catch(() => {});
    }
    const db = tenantDb(d1);
    const due = await db.select().from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.tenantId, t.id), eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now.toISOString())))
      .orderBy(webhookDeliveries.createdAt)
      .limit(100);
    if (!due.length) continue;
    const endpoints = await db.select().from(webhookEndpoints).where(inArray(webhookEndpoints.id, [...new Set(due.map((d) => d.endpointId))]));
    for (const d of due) {
      const e = endpoints.find((x) => x.id === d.endpointId);
      if (!e || !e.active) {
        await d1.prepare("UPDATE webhook_deliveries SET status = 'failed', last_error = 'Endpoint desactivado o eliminado', next_attempt_at = NULL WHERE id = ?1").bind(d.id).run();
        continue;
      }
      await attemptDelivery(d1, d, e).catch(() => false);
      retried++;
    }
  }
  return retried;
}

export async function lastDeliveries(db: TenantDb, tenantId: string, endpointId: string, limit = 50) {
  return db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.endpointId, endpointId))).orderBy(desc(webhookDeliveries.createdAt)).limit(limit);
}

/* ---------- Payloads ---------- */

/** An online order as webhooks send it (same shape for every order event). */
export function orderData(o: OrderRow, items: OrderItemRow[]) {
  return {
    id: o.id, number: o.number, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, paidMethod: o.paidMethod,
    fulfillment: o.fulfillment, customer: { name: o.customerName, email: o.customerEmail, phone: o.customerPhone, id: o.customerId },
    address: o.address, notes: o.notes, couponCode: o.couponCode, locationId: o.locationId,
    items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, sku: i.sku, name: i.name, options: i.options, quantity: fromMilli(i.quantity), unitPriceCents: i.unitPriceCents, totalCents: i.totalCents })),
    subtotalCents: o.subtotalCents, discountCents: o.discountCents, taxCents: o.taxCents, shippingCents: o.shippingCents, totalCents: o.totalCents,
    createdAt: o.createdAt, confirmedAt: o.confirmedAt, readyAt: o.readyAt, completedAt: o.completedAt, cancelledAt: o.cancelledAt, cancelReason: o.cancelReason,
  };
}
