import { Hono } from "hono";
import type { MeResponse } from "@nexo/shared";
import type { AppEnv } from "../env";
import { isPlatformAdmin } from "../middleware/auth";

export const meRoutes = new Hono<AppEnv>().get("/", (c) => {
  const { user, tenant, role } = c.var.auth;
  const body: MeResponse = {
    user,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, plan: tenant.plan, suspendedReason: tenant.suspendedReason },
    role,
    platformAdmin: isPlatformAdmin(c.env, user.email),
  };
  return c.json(body);
});
