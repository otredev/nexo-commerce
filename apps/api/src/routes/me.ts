import { Hono } from "hono";
import type { MeResponse } from "@nexo/shared";
import type { AppEnv } from "../env";

export const meRoutes = new Hono<AppEnv>().get("/", (c) => {
  const { user, tenant, role } = c.var.auth;
  const body: MeResponse = { user, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, role };
  return c.json(body);
});
