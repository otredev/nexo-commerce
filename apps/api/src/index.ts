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

/** Routes that need a session. Each module receives c.var.auth with the tenant's database. */
const protectedApi = new Hono<AppEnv>()
  .use("*", requireAuth)
  .route("/me", meRoutes)
  .route("/settings", settingsRoutes)
  .route("/taxes", taxRoutes)
  .route("/locations", locationRoutes)
  .route("/users", userRoutes)
  .route("/audit", auditRoutes)
  .route("/uploads", uploadRoutes);

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
