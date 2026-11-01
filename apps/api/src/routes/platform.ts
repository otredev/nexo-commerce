/**
 * Platform operator panel (/api/platform). Only for emails listed in PLATFORM_ADMINS;
 * everyone else gets 404, so the route does not reveal itself.
 */
import { Hono } from "hono";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { control, controlDb } from "@nexo/db";
import { effectivePlan, moveTenantSchema, platformTenantUpdateSchema, type PlatformTenant, type PlatformTenantDetail } from "@nexo/shared";
import type { AppEnv, Env } from "../env";
import { AppError } from "../lib/errors";
import { moveTenant, tenantBindings } from "../lib/moveTenant";
import { usageOf } from "../lib/plan";
import { getTenantD1 } from "../lib/tenant";
import { json } from "../lib/validate";
import { requirePlatformAdmin } from "../middleware/auth";

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "suspended", "migrating", "provisioning"]).default("all"),
  plan: z.enum(["all", "free", "pro", "business"]).default("all"),
});

type TenantRow = typeof control.tenants.$inferSelect;

async function decorate(env: Env, rows: TenantRow[]): Promise<PlatformTenant[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const db = controlDb(env.DB_CONTROL);
  const [owners, members, domains] = await Promise.all([
    db
      .select({ tenantId: control.memberships.tenantId, name: control.users.name, email: control.users.email })
      .from(control.memberships)
      .innerJoin(control.users, eq(control.users.id, control.memberships.userId))
      .where(and(inArray(control.memberships.tenantId, ids), eq(control.memberships.role, "owner"))),
    db
      .select({ tenantId: control.memberships.tenantId, n: sql<number>`count(*)` })
      .from(control.memberships)
      .where(and(inArray(control.memberships.tenantId, ids), eq(control.memberships.active, true)))
      .groupBy(control.memberships.tenantId),
    db.select({ tenantId: control.tenantDomains.tenantId, hostname: control.tenantDomains.hostname }).from(control.tenantDomains).where(inArray(control.tenantDomains.tenantId, ids)),
  ]);
  return rows.map((r) => {
    const owner = owners.find((o) => o.tenantId === r.id);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      plan: effectivePlan(r.plan, r.planStatus),
      planStatus: r.planStatus,
      dbBinding: r.dbBinding,
      createdAt: r.createdAt,
      owner: owner ? { name: owner.name, email: owner.email } : null,
      members: members.find((m) => m.tenantId === r.id)?.n ?? 0,
      domains: domains.filter((d) => d.tenantId === r.id).map((d) => d.hostname),
      suspendedReason: r.suspendedReason,
    };
  });
}

async function detail(env: Env, id: string): Promise<PlatformTenantDetail> {
  const row = await controlDb(env.DB_CONTROL).select().from(control.tenants).where(eq(control.tenants.id, id)).get();
  if (!row) throw new AppError(404, "not_found", "Negocio no encontrado");
  const [base] = await decorate(env, [row]);
  let usage: PlatformTenantDetail["usage"] = { users: base!.members, locations: 0, products: 0, sales30d: 0, sales30dCents: 0, orders30d: 0 };
  if (row.status !== "migrating" && row.status !== "provisioning") {
    const d1 = getTenantD1(env, row);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [u, activity] = await Promise.all([
      usageOf(env, row.id, d1),
      d1
        .prepare(
          `SELECT (SELECT COUNT(*) FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND created_at >= ?2) AS sales,
                  (SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND created_at >= ?2) AS cents,
                  (SELECT COUNT(*) FROM orders WHERE tenant_id = ?1 AND created_at >= ?2) AS orders`,
        )
        .bind(row.id, since)
        .first<{ sales: number; cents: number; orders: number }>(),
    ]);
    usage = { ...u, sales30d: activity?.sales ?? 0, sales30dCents: activity?.cents ?? 0, orders30d: activity?.orders ?? 0 };
  }
  return { ...base!, usage, stripeCustomerId: row.stripeCustomerId, stripeAccountId: row.stripeAccountId, availableBindings: tenantBindings(env) };
}

export const platformRoutes = new Hono<AppEnv>()
  .use("*", requirePlatformAdmin)

  .get("/tenants", async (c) => {
    const q = listQuery.parse(c.req.query());
    const t = control.tenants;
    const where = [
      q.status !== "all" ? eq(t.status, q.status) : undefined,
      q.plan !== "all" ? eq(t.plan, q.plan) : undefined,
      q.q ? or(like(t.name, `%${q.q}%`), like(t.slug, `%${q.q.toLowerCase()}%`)) : undefined,
    ].filter(Boolean);
    const rows = await controlDb(c.env.DB_CONTROL).select().from(t).where(where.length ? and(...where) : undefined).orderBy(desc(t.createdAt)).limit(200);
    const totals = await c.env.DB_CONTROL
      .prepare(
        `SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'suspended') AS suspended,
                SUM(plan <> 'free' AND plan_status <> 'canceled') AS paying FROM tenants`,
      )
      .first<{ total: number; active: number; suspended: number; paying: number }>();
    return c.json({ items: await decorate(c.env, rows), totals: { total: totals?.total ?? 0, active: totals?.active ?? 0, suspended: totals?.suspended ?? 0, paying: totals?.paying ?? 0 } });
  })

  .get("/tenants/:id", async (c) => c.json(await detail(c.env, c.req.param("id"))))

  /** Suspend / reactivate, and set the plan by hand (courtesy plans, agreements outside Stripe). */
  .patch("/tenants/:id", json(platformTenantUpdateSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const db = controlDb(c.env.DB_CONTROL);
    const row = await db.select().from(control.tenants).where(eq(control.tenants.id, id)).get();
    if (!row) throw new AppError(404, "not_found", "Negocio no encontrado");
    if (row.status === "migrating" || row.status === "provisioning") throw new AppError(409, "busy", "Espera a que termine la operación en curso.");
    if (input.status === "suspended" && id === c.var.auth.tenant.id) throw new AppError(409, "self_suspend", "No puedes suspender tu propio negocio.");
    const set: Partial<TenantRow> = {};
    if (input.status) {
      set.status = input.status;
      set.suspendedReason = input.status === "suspended" ? (input.suspendedReason ?? null) : null;
    }
    if (input.plan) {
      set.plan = input.plan;
      if (row.planStatus === "canceled" || !row.stripeSubscriptionId) set.planStatus = "active";
    }
    if (Object.keys(set).length) await db.update(control.tenants).set(set).where(eq(control.tenants.id, id));
    console.log(`[platform] ${c.var.auth.user.email} updated tenant ${row.slug}`, JSON.stringify(set));
    return c.json(await detail(c.env, id));
  })

  /** Moves the business to another D1 binding. */
  .post("/tenants/:id/move", json(moveTenantSchema), async (c) => {
    const { binding } = c.req.valid("json");
    const id = c.req.param("id");
    const result = await moveTenant(c.env, id, binding);
    console.log(`[platform] ${c.var.auth.user.email} moved tenant ${id}`, JSON.stringify(result));
    // Sessions keep working: the binding is read from the tenant on each request.
    return c.json({ result, tenant: await detail(c.env, id) });
  });

