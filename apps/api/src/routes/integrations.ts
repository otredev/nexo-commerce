/** Settings → Integraciones (Phase 11): API keys and webhook endpoints. Owners and admins, never with an API key. */
import { Hono } from "hono";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { control, controlDb, tenant } from "@nexo/db";
import { apiKeyCreateSchema, planOf, smsSettingsSchema, smsTestSchema, webhookEndpointSchema, webhookUrlProblem, type IntegrationsSettings } from "@nexo/shared";
import type { AppEnv } from "../env";
import { generateApiKey, toApiKey } from "../lib/apiKeys";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { toStatement } from "../lib/inventory";
import { attemptDelivery, emitEvent, lastDeliveries, newWebhookSecret, toDelivery, toEndpoint } from "../lib/outbound";
import { json } from "../lib/validate";
import { sealSecret } from "../lib/secrets";
import { sendSms, smsConfig, toE164, verifyTwilio } from "../lib/sms";
import { getSettings } from "../lib/sales";
import { requirePermission } from "../middleware/auth";

const { webhookEndpoints, webhookDeliveries, smsSettings } = tenant;

const limitError = (what: string, limit: number, plan: string) =>
  new AppError(402, "plan_limit", `Tu plan ${plan} permite hasta ${limit} ${what}. Mejora tu plan en Configuración › Plan para agregar más.`);

export const integrationRoutes = new Hono<AppEnv>()
  .use("*", requirePermission("integrations:manage"))

  .get("/", async (c) => {
    const { db, tenant: t } = c.var.auth;
    const [keys, hooks, sms] = await Promise.all([
      controlDb(c.env.DB_CONTROL).select().from(control.apiKeys).where(and(eq(control.apiKeys.tenantId, t.id), isNull(control.apiKeys.revokedAt))).orderBy(desc(control.apiKeys.createdAt)),
      db.select().from(webhookEndpoints).where(eq(webhookEndpoints.tenantId, t.id)).orderBy(webhookEndpoints.createdAt),
      smsConfig(db, t.id),
    ]);
    const base = c.env.APP_URL.replace(/\/$/, "");
    const plan = planOf(t.plan);
    const body: IntegrationsSettings = {
      apiKeys: keys.map(toApiKey),
      webhooks: hooks.map(toEndpoint),
      limits: { apiKeys: plan.limits.apiKeys, webhooks: plan.limits.webhooks },
      apiUrl: `${base}/api`,
      mcpUrl: `${base}/mcp`,
      sms: sms ? { provider: "twilio", accountSid: sms.accountSid, sender: sms.sender, updatedAt: sms.updatedAt } : null,
    };
    return c.json(body);
  })

  /* ---------- Text messages (Twilio) ---------- */
  .put("/sms", json(smsSettingsSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const current = await smsConfig(db, t.id);
    const sameAccount = current?.accountSid === input.accountSid;
    if (!input.authToken && !sameAccount) throw new AppError(422, "validation_error", "Escribe el Auth Token", { authToken: "Escribe el Auth Token" });
    if (input.authToken) await verifyTwilio(c.env, input.accountSid, input.authToken);
    const authTokenEnc = input.authToken ? await sealSecret(c.env, t.id, input.authToken) : current!.authTokenEnc;
    const now = new Date().toISOString();
    await d1.batch([
      toStatement(d1, db.insert(smsSettings).values({ tenantId: t.id, provider: "twilio", accountSid: input.accountSid, authTokenEnc, sender: input.sender, updatedAt: now })
        .onConflictDoUpdate({ target: smsSettings.tenantId, set: { accountSid: input.accountSid, authTokenEnc, sender: input.sender, updatedAt: now } })),
      toStatement(d1, auditEntry(c, { action: current ? "integration.sms_update" : "integration.sms_create", entity: "sms_settings", entityId: t.id, after: { accountSid: input.accountSid, sender: input.sender } })),
    ]);
    return c.json({ provider: "twilio", accountSid: input.accountSid, sender: input.sender, updatedAt: now });
  })

  .delete("/sms", async (c) => {
    const { db, d1, tenant: t } = c.var.auth;
    await d1.batch([
      toStatement(d1, db.delete(smsSettings).where(eq(smsSettings.tenantId, t.id))),
      toStatement(d1, auditEntry(c, { action: "integration.sms_delete", entity: "sms_settings", entityId: t.id })),
    ]);
    return c.body(null, 204);
  })

  .post("/sms/test", json(smsTestSchema), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const s = await getSettings(c);
    const to = toE164(c.req.valid("json").phone, s.currency);
    if (!to) throw new AppError(422, "validation_error", "Teléfono no válido", { phone: "Revisa el número" });
    await sendSms(c.env, db, t.id, to, `${s.tradeName}: mensaje de prueba de Nexo. Los recibos por texto ya están listos.`);
    return c.body(null, 204);
  })

  /* ---------- API keys ---------- */
  .post("/api-keys", json(apiKeyCreateSchema), async (c) => {
    const input = c.req.valid("json");
    const { d1, tenant: t, user } = c.var.auth;
    const cdb = controlDb(c.env.DB_CONTROL);
    const plan = planOf(t.plan);
    if (plan.limits.apiKeys !== null) {
      const used = (await cdb.select({ n: count() }).from(control.apiKeys).where(and(eq(control.apiKeys.tenantId, t.id), isNull(control.apiKeys.revokedAt))).get())?.n ?? 0;
      if (used >= plan.limits.apiKeys) throw limitError("llaves de API", plan.limits.apiKeys, plan.name);
    }
    const { key, hash, prefix } = await generateApiKey();
    const id = `key_${newId()}`;
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null;
    await cdb.insert(control.apiKeys).values({ id, tenantId: t.id, name: input.name, prefix, hash, access: input.access, createdBy: user.id, createdByName: user.name, expiresAt });
    await toStatement(d1, auditEntry(c, { action: "api_key.create", entity: "api_key", entityId: id, after: { name: input.name, access: input.access, prefix, expiresAt } })).run();
    const row = (await cdb.select().from(control.apiKeys).where(eq(control.apiKeys.id, id)).get())!;
    // The full key is returned only now.
    return c.json({ apiKey: toApiKey(row), key }, 201);
  })

  .delete("/api-keys/:id", async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const cdb = controlDb(c.env.DB_CONTROL);
    const row = await cdb.select().from(control.apiKeys).where(and(eq(control.apiKeys.id, c.req.param("id")), eq(control.apiKeys.tenantId, t.id), isNull(control.apiKeys.revokedAt))).get();
    if (!row) throw notFound("Llave");
    await cdb.update(control.apiKeys).set({ revokedAt: new Date().toISOString() }).where(eq(control.apiKeys.id, row.id));
    await toStatement(d1, auditEntry(c, { action: "api_key.revoke", entity: "api_key", entityId: row.id, before: { name: row.name, prefix: row.prefix } })).run();
    return c.body(null, 204);
  })

  /* ---------- Webhooks ---------- */
  .post("/webhooks", json(webhookEndpointSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const problem = webhookUrlProblem(input.url, c.env.APP_ENV === "development");
    if (problem) throw new AppError(422, "validation_error", "Revisa los campos marcados", { url: problem });
    const plan = planOf(t.plan);
    if (plan.limits.webhooks !== null) {
      const used = (await db.select({ n: count() }).from(webhookEndpoints).where(eq(webhookEndpoints.tenantId, t.id)).get())?.n ?? 0;
      if (used >= plan.limits.webhooks) throw limitError(plan.limits.webhooks === 1 ? "webhook" : "webhooks", plan.limits.webhooks, plan.name);
    }
    const id = `we_${newId()}`;
    await d1.batch([
      toStatement(d1, db.insert(webhookEndpoints).values({ id, tenantId: t.id, url: input.url, description: input.description, events: input.events, active: input.active, secret: newWebhookSecret() })),
      toStatement(d1, auditEntry(c, { action: "webhook.create", entity: "webhook", entityId: id, after: { url: input.url, events: input.events } })),
    ]);
    return c.json(toEndpoint((await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).get())!), 201);
  })

  .put("/webhooks/:id", json(webhookEndpointSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const row = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, c.req.param("id")), eq(webhookEndpoints.tenantId, t.id))).get();
    if (!row) throw notFound("Webhook");
    const problem = webhookUrlProblem(input.url, c.env.APP_ENV === "development");
    if (problem) throw new AppError(422, "validation_error", "Revisa los campos marcados", { url: problem });
    const now = new Date().toISOString();
    await d1.batch([
      // Re-enabling starts a clean failure count.
      toStatement(d1, db.update(webhookEndpoints).set({ url: input.url, description: input.description, events: input.events, active: input.active, updatedAt: now, ...(input.active && !row.active ? { failures: 0 } : {}) }).where(eq(webhookEndpoints.id, row.id))),
      toStatement(d1, auditEntry(c, { action: "webhook.update", entity: "webhook", entityId: row.id, before: { url: row.url, events: row.events, active: row.active }, after: { url: input.url, events: input.events, active: input.active } })),
    ]);
    return c.json(toEndpoint((await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, row.id)).get())!));
  })

  .delete("/webhooks/:id", async (c) => {
    const { db, d1, tenant: t } = c.var.auth;
    const row = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, c.req.param("id")), eq(webhookEndpoints.tenantId, t.id))).get();
    if (!row) throw notFound("Webhook");
    await d1.batch([
      toStatement(d1, db.delete(webhookDeliveries).where(and(eq(webhookDeliveries.tenantId, t.id), eq(webhookDeliveries.endpointId, row.id)))),
      toStatement(d1, db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, row.id))),
      toStatement(d1, auditEntry(c, { action: "webhook.delete", entity: "webhook", entityId: row.id, before: { url: row.url } })),
    ]);
    return c.body(null, 204);
  })

  .post("/webhooks/:id/rotate-secret", async (c) => {
    const { db, d1, tenant: t } = c.var.auth;
    const row = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, c.req.param("id")), eq(webhookEndpoints.tenantId, t.id))).get();
    if (!row) throw notFound("Webhook");
    await d1.batch([
      toStatement(d1, db.update(webhookEndpoints).set({ secret: newWebhookSecret(), updatedAt: new Date().toISOString() }).where(eq(webhookEndpoints.id, row.id))),
      toStatement(d1, auditEntry(c, { action: "webhook.rotate_secret", entity: "webhook", entityId: row.id })),
    ]);
    return c.json(toEndpoint((await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, row.id)).get())!));
  })

  /** Sends a "ping" to this endpoint now and returns how it went. */
  .post("/webhooks/:id/test", async (c) => {
    const { db, tenant: t, user } = c.var.auth;
    const row = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, c.req.param("id")), eq(webhookEndpoints.tenantId, t.id))).get();
    if (!row) throw notFound("Webhook");
    await emitEvent(c.env, t, "ping", { message: "Prueba desde Nexo", by: user.name }, row.id);
    const [last] = await lastDeliveries(db, t.id, row.id, 1);
    return c.json(toDelivery(last!));
  })

  .get("/webhooks/:id/deliveries", async (c) => {
    const { db, tenant: t } = c.var.auth;
    const row = await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(and(eq(webhookEndpoints.id, c.req.param("id")), eq(webhookEndpoints.tenantId, t.id))).get();
    if (!row) throw notFound("Webhook");
    return c.json((await lastDeliveries(db, t.id, row.id, 50)).map(toDelivery));
  })

  /** What was sent in a delivery (to debug the receiving side). */
  .get("/webhooks/deliveries/:id", async (c) => {
    const { db, tenant: t } = c.var.auth;
    const d = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.id, c.req.param("id")), eq(webhookDeliveries.tenantId, t.id))).get();
    if (!d) throw notFound("Entrega");
    return c.json({ ...toDelivery(d), payload: JSON.parse(d.payload) as unknown });
  })

  /** Sends a delivery again now (also a failed one). */
  .post("/webhooks/deliveries/:id/resend", async (c) => {
    const { db, d1, tenant: t } = c.var.auth;
    const d = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.id, c.req.param("id")), eq(webhookDeliveries.tenantId, t.id))).get();
    if (!d) throw notFound("Entrega");
    const e = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId)).get();
    if (!e) throw notFound("Webhook");
    // A manual resend gets a fresh set of retries.
    await d1.prepare("UPDATE webhook_deliveries SET status = 'pending', attempts = 0 WHERE id = ?1").bind(d.id).run();
    await attemptDelivery(d1, { ...d, status: "pending", attempts: 0 }, e);
    return c.json(toDelivery((await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d.id)).get())!));
  });
