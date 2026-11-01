import { createMiddleware } from "hono/factory";
import { can, type Permission } from "@nexo/shared";
import type { AppEnv } from "../env";
import { AppError, forbidden, unauthorized } from "../lib/errors";
import { loadSession } from "../lib/session";
import { getTenantDb } from "../lib/tenant";

/** Loads the session, its tenant and the tenant's database into c.var.auth. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const session = await loadSession(c);
  if (!session) throw unauthorized();
  // A suspended business only reaches its profile and billing (to pay and reactivate);
  // one being moved to another database waits a moment.
  const path = new URL(c.req.url).pathname;
  const open = path === "/api/me" || path.startsWith("/api/billing");
  if (session.tenant.status === "suspended" && !open) {
    throw new AppError(403, "tenant_suspended", session.tenant.suspendedReason ? `Esta cuenta está suspendida: ${session.tenant.suspendedReason}` : "Esta cuenta está suspendida. Contacta a soporte.");
  }
  if (session.tenant.status === "migrating" && path !== "/api/me") {
    throw new AppError(503, "tenant_migrating", "Estamos moviendo tus datos. Vuelve a intentarlo en un minuto.");
  }
  const { db, d1 } = getTenantDb(c.env, session.tenant);
  c.set("auth", { ...session, db, d1 });
  await next();
});

export const requirePermission = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.var.auth.role, permission)) throw forbidden();
    await next();
  });

/** Platform operators: emails listed in PLATFORM_ADMINS. */
export const isPlatformAdmin = (env: AppEnv["Bindings"], email: string) =>
  (env.PLATFORM_ADMINS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());

export const requirePlatformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isPlatformAdmin(c.env, c.var.auth.user.email)) throw new AppError(404, "not_found", "Ruta no encontrada");
  await next();
});
