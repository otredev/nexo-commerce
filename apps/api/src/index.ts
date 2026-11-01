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
  .route("/counts", countRoutes);

const app = new Hono<AppEnv>()
  .use("/api/*", secureHeaders(), sameOrigin)
  .get("/api/health", (c) => c.json({ ok: true, env: c.env.APP_ENV, time: new Date().toISOString() }))
  .route("/api/auth", authRoutes)
  // Development only: run the daily backup on demand.
  .post("/api/dev/backup", async (c) => {
    if (c.env.APP_ENV !== "development") return c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404);
    await cleanupControl(c.env);
    return c.json(await runBackup(c.env));
  })
  .route("/api", protectedApi)
  .route("/files", fileRoutes)
  .all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, 404));

app.onError((err, c) => errorResponse(c, err));
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await cleanupControl(env);
        const result = await runBackup(env);
        console.log(`[backup] ${result.prefix}: ${result.tables} tables, ${result.rows} rows`);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
