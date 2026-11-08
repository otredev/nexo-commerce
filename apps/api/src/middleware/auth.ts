import { createMiddleware } from "hono/factory";
import { API_KEY_BLOCKED_PATHS, can, type Permission } from "@nexo/shared";
import type { AppEnv } from "../env";
import { AppError, forbidden, unauthorized } from "../lib/errors";
import { loadSession, type LoadedSession } from "../lib/session";
import { bearerKey, loadApiKey, type KeySession } from "../lib/apiKeys";
import { getTenantDb } from "../lib/tenant";

/** What support cannot change while inside a business. */
const SUPPORT_BLOCKED_PATHS = ["/api/billing", "/api/integrations", "/api/users", "/api/notifications", "/api/support", "/api/auth/password"];

/**
 * Loads the session (cookie) or the API key (Authorization: Bearer nx_…), its tenant and the tenant's
 * database into c.var.auth.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const key = bearerKey(c);
  if (c.req.header("authorization") && !key) throw new AppError(401, "invalid_api_key", "Llave de API no válida.");
  const session: (LoadedSession & { apiKey?: KeySession["apiKey"] }) | null = key ? await loadApiKey(c, key) : await loadSession(c);
  if (!session) throw key ? new AppError(401, "invalid_api_key", "Llave de API no válida, revocada o vencida.") : unauthorized();
  if (session.apiKey) {
    if (API_KEY_BLOCKED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) throw new AppError(403, "forbidden_for_api_key", "Esta operación no está disponible con una llave de API.");
    if (session.apiKey.readOnly && c.req.method !== "GET" && c.req.method !== "HEAD") throw new AppError(403, "read_only_key", "Esta llave es de solo lectura.");
  }
  // Support access (an operator inside the business) reads everything but does not touch money,
  // keys, people, notifications, passwords or the business's own support tickets.
  if (session.support && c.req.method !== "GET" && c.req.method !== "HEAD" && SUPPORT_BLOCKED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    throw new AppError(403, "forbidden_for_support", "Soporte no puede hacer este cambio. Pídeselo al propietario del negocio.");
  }
  // A suspended business only reaches its profile and billing (to pay and reactivate);
  // one being moved to another database waits a moment.
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

