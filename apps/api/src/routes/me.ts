import { Hono } from "hono";
import { and, count, eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import type { MeResponse } from "@nexo/shared";
import type { AppEnv } from "../env";
import { allowed } from "../middleware/auth";

export const meRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { user, tenant, role, support, sessionId } = c.var.auth;
  const cdb = controlDb(c.env.DB_CONTROL);
  const [waiting, session] = await Promise.all([
    allowed(c.var.auth, "support:use") && !support
      ? cdb.select({ n: count() }).from(control.supportTickets).where(and(eq(control.supportTickets.tenantId, tenant.id), eq(control.supportTickets.status, "waiting"))).get()
      : null,
    support
      ? cdb
          .select({ expiresAt: control.sessions.expiresAt, number: control.supportTickets.number })
          .from(control.sessions)
          .leftJoin(control.supportTickets, eq(control.supportTickets.id, control.sessions.ticketId))
          .where(eq(control.sessions.id, sessionId))
          .get()
      : null,
  ]);
  const body: MeResponse = {
    user,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, plan: tenant.plan, suspendedReason: tenant.suspendedReason },
    role,
    permissions: c.var.auth.permissions,
    roleName: c.var.auth.roleName,
    support: support && session ? { operatorName: support.operatorName, expiresAt: session.expiresAt, ticketNumber: session.number ?? null } : null,
    supportWaiting: waiting?.n ?? 0,
  };
  return c.json(body);
});
