import { createMiddleware } from "hono/factory";
import { can, type Permission } from "@nexo/shared";
import type { AppEnv } from "../env";
import { forbidden, unauthorized } from "../lib/errors";
import { loadSession } from "../lib/session";
import { getTenantDb } from "../lib/tenant";

/** Loads the session, its tenant and the tenant's database into c.var.auth. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const session = await loadSession(c);
  if (!session) throw unauthorized();
  const { db, d1 } = getTenantDb(c.env, session.tenant);
  c.set("auth", { ...session, db, d1 });
  await next();
});

export const requirePermission = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.var.auth.role, permission)) throw forbidden();
    await next();
  });
