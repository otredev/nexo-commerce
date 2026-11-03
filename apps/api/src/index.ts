import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Env } from "./env";
import { cleanupControl, runBackup } from "./backup";
import { errorResponse } from "./lib/errors";
import { requireAuth } from "./middleware/auth";
import { sameOrigin } from "./middleware/security";
import { auditRoutes } from "./routes/audit";
import { authRoutes } from "./routes/auth";
import { locationRoutes } from "./routes/locations";
import { meRoutes } from "./routes/me";
import { settingsRoutes } from "./routes/settings";
import { taxRoutes } from "./routes/taxes";
import { fileRoutes, uploadRoutes } from "./routes/uploads";
import { userRoutes } from "./routes/users";
import { productRoutes } from "./routes/products";
import { brandRoutes, categoryRoutes } from "./routes/named";
import { inventoryRoutes } from "./routes/inventory";
import { saleRoutes } from "./routes/sales";
import { cashRoutes } from "./routes/cash";
import { posRoutes } from "./routes/pos";
import { reportRoutes } from "./routes/reports";
import { supplierRoutes } from "./routes/suppliers";
import { purchaseRoutes } from "./routes/purchases";
import { transferRoutes } from "./routes/transfers";
import { countRoutes } from "./routes/counts";
import { orderRoutes } from "./routes/orders";
import { storeAdminRoutes } from "./routes/storeAdmin";
import { storeRoutes } from "./routes/store";
import { expireOrders } from "./lib/orders";
import { customerRoutes } from "./routes/customers";
import { promotionRoutes } from "./routes/promotions";
import { payableRoutes } from "./routes/payables";
import { billingRoutes } from "./routes/billing";
import { platformRoutes } from "./routes/platform";
import { processStripeEvent, type StripeEvent } from "./lib/webhooks";
import { verifyStripeSignature } from "./lib/stripe";
import { refreshPendingDomains } from "./lib/domains";
import { storeIndex } from "./lib/storeIndex";
import { notificationRoutes } from "./routes/notifications";
import { integrationRoutes } from "./routes/integrations";
import { retryWebhooks } from "./lib/outbound";
import { handleMcp } from "./lib/mcp";
import { posDisplayRoutes, publicDisplayRoutes } from "./routes/display";
export { DisplayHub } from "./display";
import { dailyDigest } from "./lib/notify";
import { AppError } from "./lib/errors";
import { control, controlDb } from "@nexo/db";
import { and, eq } from "drizzle-orm";

/** Routes that need a session. Each module receives c.var.auth with the tenant's database. */
const protectedApi = new Hono<AppEnv>()
  .use("*", requireAuth)
  .route("/me", meRoutes)
  .route("/settings", settingsRoutes)
  .route("/taxes", taxRoutes)
  .route("/locations", locationRoutes)
  .route("/users", userRoutes)
  .route("/audit", auditRoutes)
  .route("/uploads", uploadRoutes)
  .route("/products", productRoutes)
  .route("/categories", categoryRoutes)
  .route("/brands", brandRoutes)
  .route("/inventory", inventoryRoutes)
  .route("/pos", posRoutes)
  .route("/sales", saleRoutes)
  .route("/cash", cashRoutes)
  .route("/reports", reportRoutes)
  .route("/suppliers", supplierRoutes)
  .route("/purchases", purchaseRoutes)
  .route("/transfers", transferRoutes)
  .route("/counts", countRoutes)
  .route("/orders", orderRoutes)
  .route("/store-settings", storeAdminRoutes)
  .route("/customers", customerRoutes)
  .route("/promotions", promotionRoutes)
  .route("/payables", payableRoutes)
  .route("/billing", billingRoutes)
  .route("/platform", platformRoutes)
  .route("/notifications", notificationRoutes)
  .route("/integrations", integrationRoutes)
  .route("/pos/display", posDisplayRoutes);

const app = new Hono<AppEnv>()
  .use("/api/*", secureHeaders(), sameOrigin)
  .get("/api/health", (c) => c.json({ ok: true, env: c.env.APP_ENV, time: new Date().toISOString() }))
  .route("/api/auth", authRoutes)
  // Public online store (no session). Must be mounted before the protected API.
  .route("/api/store", storeRoutes)
  // Stripe webhooks (platform and Connect endpoints). The signature is the authentication.
  .post("/api/webhooks/stripe", async (c) => {
    const body = await c.req.text();
    const ok = await verifyStripeSignature(body, c.req.header("stripe-signature"), [c.env.STRIPE_WEBHOOK_SECRET, c.env.STRIPE_CONNECT_WEBHOOK_SECRET]);
    if (!ok) throw new AppError(400, "bad_signature", "Firma no válida");
    const event = JSON.parse(body) as StripeEvent;
    const applied = await processStripeEvent(c.env, event);
    return c.json({ received: true, duplicate: !applied });
  })
  // Customer display on a tablet or TV, paired with a register by code (no sign-in).
  .route("/api/display", publicDisplayRoutes)
  // Public, indexable stores of the platform: the store domain's /sitemap.xml lists them.
  .get("/api/store-index", async (c) => c.json(await storeIndex(c.env), 200, { "Cache-Control": "public, max-age=3600" }))
  // The store on a customer's own domain asks which store the hostname belongs to (active domains only).
  .get("/api/store-host/:hostname", async (c) => {
    const hostname = c.req.param("hostname").toLowerCase();
    const row = await controlDb(c.env.DB_CONTROL)
      .select({ slug: control.tenants.slug })
      .from(control.tenantDomains)
      .innerJoin(control.tenants, eq(control.tenants.id, control.tenantDomains.tenantId))
      .where(and(eq(control.tenantDomains.hostname, hostname), eq(control.tenantDomains.status, "active"), eq(control.tenants.status, "active")))
      .get();
    if (!row) throw new AppError(404, "not_found", "Dominio no registrado");
    return c.json(row, 200, { "Cache-Control": "public, max-age=300" });
  })
  // Development only: run the daily backup on demand.
  .post("/api/dev/backup", async (c) => {
    if (c.env.APP_ENV !== "development") return c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404);
    await cleanupControl(c.env);
    return c.json(await runBackup(c.env));
  })
  // Development only: run the hourly order-expiry job on demand.
  .post("/api/dev/expire-orders", async (c) => {
    if (c.env.APP_ENV !== "development") return c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404);
    return c.json({ expired: await expireOrders(c.env), domains: await refreshPendingDomains(c.env) });
  })
  // Development only: send the morning digest now (?tenantId= to limit it).
  .post("/api/dev/digest", async (c) => {
    if (c.env.APP_ENV !== "development") return c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404);
    return c.json({ sent: await dailyDigest(c.env, new Date(), { force: true, tenantId: c.req.query("tenantId") }) });
  })
  // Development only: run the webhook retry job now (?at= ISO time to pretend it is later).
  .post("/api/dev/webhooks-retry", async (c) => {
    if (c.env.APP_ENV !== "development") return c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404);
    const at = c.req.query("at");
    return c.json({ retried: await retryWebhooks(c.env, at ? new Date(at) : new Date()) });
  })
  // Development only: set the plan of the signed-in business (the smoke tests need more than the free plan).
  .post("/api/dev/plan", requireAuth, async (c) => {
    if (c.env.APP_ENV !== "development") return c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404);
    const { plan } = (await c.req.json()) as { plan: string };
    if (!["free", "pro", "business"].includes(plan)) throw new AppError(422, "validation_error", "Plan no válido");
    await controlDb(c.env.DB_CONTROL).update(control.tenants).set({ plan, planStatus: "active" }).where(eq(control.tenants.id, c.var.auth.tenant.id));
    return c.json({ plan });
  })
  .route("/api", protectedApi)
  // MCP server for AI assistants (Phase 11). Each tool calls this same API with the caller's key.
  .all("/mcp", (c) =>
    handleMcp(c, (token) => (method, path, body) =>
      internalFetch(
        new Request(new URL(path, c.req.url), {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), "user-agent": "Nexo-MCP/1.0" },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        c.env,
        c.executionCtx as unknown as ExecutionContext<unknown>,
      ),
    ),
  )
  .route("/files", fileRoutes)
  .all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404));

app.onError((err, c) => errorResponse(c, err));

/** The API calling itself (MCP tools): same routes, auth and validation, no network hop. */
function internalFetch(req: Request, env: Env, ctx: ExecutionContext<unknown>): Promise<Response> {
  return Promise.resolve(app.fetch(req, env, ctx));
}
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "15 * * * *") {
      ctx.waitUntil(expireOrders(env).then((n) => { if (n) console.log(`[orders] released ${n} expired orders`); }));
      ctx.waitUntil(refreshPendingDomains(env).catch((e) => console.error("[domains] cron", e)));
      // 8:00 in each business's time zone: low stock and invoices due.
      // Outgoing webhooks that failed: next attempt (Phase 11).
      ctx.waitUntil(retryWebhooks(env).then((n) => { if (n) console.log(`[webhooks] retried ${n}`); }).catch((e) => console.error("[webhooks] retry", e)));
      ctx.waitUntil(dailyDigest(env).then((n) => { if (n) console.log(`[push] digest sent ${n}`); }).catch((e) => console.error("[push] digest", e)));
      return;
    }
    ctx.waitUntil(
      (async () => {
        await cleanupControl(env);
        const result = await runBackup(env);
        console.log(`[backup] ${result.prefix}: ${result.tables} tables, ${result.rows} rows`);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
