/**
 * Platform metrics for /admin: businesses, plans and recurring revenue (control DB) plus activity of the
 * last 30 days, read with one query per tenant database (never one per business).
 */
import { PLAN_IDS, PLANS, effectivePlan, type PlanId, type PlatformMetrics } from "@nexo/shared";
import type { Env } from "../env";
import { tenantBindings } from "./moveTenant";

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export async function platformMetrics(env: Env, now = new Date()): Promise<PlatformMetrics> {
  const db = env.DB_CONTROL;
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const [tenants, users, signups, support] = await Promise.all([
    db
      .prepare("SELECT id, name, status, plan, plan_status AS planStatus, stripe_subscription_id AS sub, db_binding AS binding, created_at AS createdAt FROM tenants WHERE status <> 'provisioning'")
      .all<{ id: string; name: string; status: string; plan: string; planStatus: "active" | "trialing" | "past_due" | "canceled"; sub: string | null; binding: string; createdAt: string }>(),
    db
      .prepare("SELECT COUNT(*) AS total, SUM(created_at >= ?1) AS recent, SUM(disabled_at IS NOT NULL) AS disabled FROM users WHERE deleted_at IS NULL")
      .bind(since30)
      .first<{ total: number; recent: number | null; disabled: number | null }>(),
    db
      .prepare("SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS n FROM tenants WHERE created_at >= ?1 AND status <> 'provisioning' GROUP BY month")
      .bind(first.toISOString())
      .all<{ month: string; n: number }>(),
    db
      .prepare("SELECT SUM(status = 'open') AS open, SUM(status = 'waiting') AS waiting, SUM(status <> 'closed' AND assigned_to IS NULL) AS unassigned FROM support_tickets")
      .first<{ open: number | null; waiting: number | null; unassigned: number | null }>(),
  ]);

  const rows = tenants.results;
  const byPlan = Object.fromEntries(PLAN_IDS.map((p) => [p, 0])) as Record<PlanId, number>;
  const billing = { mrrCents: 0, subscribed: 0, trialing: 0, pastDue: 0, courtesy: 0 };
  for (const t of rows) {
    const plan = effectivePlan(t.plan, t.planStatus);
    byPlan[plan] += 1;
    if (plan === "free") continue;
    if (!t.sub) billing.courtesy += 1;
    else if (t.planStatus === "trialing") billing.trialing += 1;
    else {
      billing.subscribed += 1;
      if (t.planStatus === "past_due") billing.pastDue += 1;
      billing.mrrCents += PLANS[plan].priceCents;
    }
  }

  // Twelve months, with zeros where nobody signed up.
  const perMonth = new Map(signups.results.map((r) => [r.month, r.n]));
  const months = Array.from({ length: 12 }, (_, i) => monthKey(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1))));

  // Activity: one query per tenant database (every business on it at once).
  const names = new Map(rows.map((t) => [t.id, t.name]));
  const bindings = [...new Set([...tenantBindings(env), ...rows.map((t) => t.binding)])].filter((b) => (env as unknown as Record<string, unknown>)[b]);
  const perDb = await Promise.all(
    bindings.map(async (binding) => {
      const d1 = (env as unknown as Record<string, D1Database>)[binding]!;
      const [days, volume, perTenant] = await d1.batch<Record<string, unknown>>([
        d1.prepare(
          `SELECT d, SUM(s) AS sales, SUM(o) AS orders FROM (
             SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS s, 0 AS o FROM sales WHERE status = 'completed' AND created_at >= ?1 GROUP BY d
             UNION ALL
             SELECT substr(created_at, 1, 10) AS d, 0 AS s, COUNT(*) AS o FROM orders WHERE created_at >= ?1 GROUP BY d
           ) GROUP BY d`,
        ).bind(since30),
        d1.prepare(
          `SELECT b.currency AS currency, SUM(s.total_cents) AS cents FROM sales s JOIN business_settings b ON b.tenant_id = s.tenant_id
           WHERE s.status = 'completed' AND s.created_at >= ?1 GROUP BY b.currency`,
        ).bind(since30),
        d1.prepare(
          `SELECT tenant_id AS tenantId, SUM(s) AS sales, SUM(o) AS orders FROM (
             SELECT tenant_id, COUNT(*) AS s, 0 AS o FROM sales WHERE status = 'completed' AND created_at >= ?1 GROUP BY tenant_id
             UNION ALL
             SELECT tenant_id, 0 AS s, COUNT(*) AS o FROM orders WHERE created_at >= ?1 GROUP BY tenant_id
           ) GROUP BY tenant_id`,
        ).bind(since30),
      ]);
      return {
        days: (days?.results ?? []) as Array<{ d: string; sales: number; orders: number }>,
        volume: (volume?.results ?? []) as Array<{ currency: string; cents: number }>,
        perTenant: (perTenant?.results ?? []) as Array<{ tenantId: string; sales: number; orders: number }>,
      };
    }).map((p) =>
      // A database without the tenant tables yet (declared but not migrated) must not break the page.
      p.catch((e) => {
        console.error("[platform] metrics", e);
        return { days: [], volume: [], perTenant: [] };
      }),
    ),
  );

  const dayMap = new Map<string, { sales: number; orders: number }>();
  const volume = new Map<string, number>();
  const perTenant = new Map<string, { sales: number; orders: number }>();
  for (const part of perDb) {
    for (const r of part.days) {
      const cur = dayMap.get(r.d) ?? { sales: 0, orders: 0 };
      dayMap.set(r.d, { sales: cur.sales + Number(r.sales), orders: cur.orders + Number(r.orders) });
    }
    for (const r of part.volume) volume.set(r.currency, (volume.get(r.currency) ?? 0) + Number(r.cents));
    // A business lives in one database; after a move the old one is empty, so adding is safe.
    for (const r of part.perTenant) {
      if (!names.has(r.tenantId)) continue;
      const cur = perTenant.get(r.tenantId) ?? { sales: 0, orders: 0 };
      perTenant.set(r.tenantId, { sales: cur.sales + Number(r.sales), orders: cur.orders + Number(r.orders) });
    }
  }
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now.getTime() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, ...(dayMap.get(date) ?? { sales: 0, orders: 0 }) };
  });
  const top = [...perTenant.entries()]
    .map(([tenantId, v]) => ({ tenantId, name: names.get(tenantId) ?? tenantId, ...v }))
    .sort((a, b) => b.sales + b.orders - (a.sales + a.orders))
    .slice(0, 8);

  return {
    tenants: {
      total: rows.length,
      active: rows.filter((t) => t.status === "active").length,
      suspended: rows.filter((t) => t.status === "suspended").length,
      newThisMonth: perMonth.get(thisMonth) ?? 0,
      newLastMonth: perMonth.get(lastMonth) ?? 0,
    },
    byPlan,
    billing,
    users: { total: users?.total ?? 0, newLast30d: users?.recent ?? 0, disabled: users?.disabled ?? 0 },
    signups: months.map((month) => ({ month, count: perMonth.get(month) ?? 0 })),
    activity: {
      days,
      sales30d: days.reduce((a, d) => a + d.sales, 0),
      orders30d: days.reduce((a, d) => a + d.orders, 0),
      activeTenants30d: perTenant.size,
      volumeByCurrency: [...volume.entries()].map(([currency, cents]) => ({ currency, cents })).sort((a, b) => b.cents - a.cents),
      top,
    },
    support: { open: support?.open ?? 0, waiting: support?.waiting ?? 0, unassigned: support?.unassigned ?? 0 },
  };
}
