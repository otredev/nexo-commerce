import { Hono } from "hono";
import { businessDate, can, fromMilli, type DashboardData, type UnitCode } from "@nexo/shared";
import type { AppEnv } from "../env";
import { getSettings } from "../lib/sales";
import { requirePermission } from "../middleware/auth";

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Home dashboard: reads the daily summary tables, never scans all sales. */
export const reportRoutes = new Hono<AppEnv>().get("/dashboard", requirePermission("sales:read"), async (c) => {
  const { d1, tenant: t, role } = c.var.auth;
  const settings = await getSettings(c);
  const today = businessDate(settings.timezone);
  const from = shiftDate(today, -6);
  const [daysRes, topRes, sessionsRes, ordersRes] = await d1.batch([
    d1
      .prepare(
        `SELECT date, SUM(sales_count) AS count, SUM(total_cents) AS total, SUM(returns_cents) AS returns, SUM(cost_cents) AS cost, SUM(online_count) AS online_count, SUM(online_total_cents) AS online_total
         FROM daily_sales WHERE tenant_id = ?1 AND date >= ?2 AND date <= ?3 GROUP BY date`,
      )
      .bind(t.id, shiftDate(today, -7), today),
    d1
      .prepare(
        `SELECT d.product_id, p.name, v.options, p.unit, SUM(d.quantity) AS qty, SUM(d.total_cents) AS total
         FROM daily_product_sales d JOIN products p ON p.id = d.product_id JOIN variants v ON v.id = d.variant_id
         WHERE d.tenant_id = ?1 AND d.date >= ?2 AND d.date <= ?3
         GROUP BY d.variant_id HAVING SUM(d.quantity) > 0 ORDER BY total DESC LIMIT 5`,
      )
      .bind(t.id, from, today),
    d1
      .prepare(
        `SELECT s.id, l.name AS location_name, s.opened_by_name, s.opened_at FROM cash_sessions s LEFT JOIN locations l ON l.id = s.location_id
         WHERE s.tenant_id = ?1 AND s.status = 'open' ORDER BY s.opened_at`,
      )
      .bind(t.id),
    d1
      .prepare(
        `SELECT (SELECT enabled FROM store_settings WHERE tenant_id = ?1) AS enabled,
           (SELECT COUNT(*) FROM orders WHERE tenant_id = ?1 AND status = 'pending') AS pending,
           (SELECT COUNT(*) FROM orders WHERE tenant_id = ?1 AND status IN ('pending', 'confirmed', 'ready')) AS open`,
      )
      .bind(t.id),
  ]);
  const ord = ordersRes!.results[0] as { enabled: number | null; pending: number; open: number };
  type Day = { date: string; count: number; total: number; returns: number; cost: number; online_count: number; online_total: number };
  const byDate = new Map((daysRes!.results as Day[]).map((d) => [d.date, d]));
  const day = (date: string) => byDate.get(date) ?? { date, count: 0, total: 0, returns: 0, cost: 0, online_count: 0, online_total: 0 };
  const td = day(today);
  const net = (d: Day) => d.total - d.returns;
  const body: DashboardData = {
    today,
    sales: {
      count: td.count,
      totalCents: net(td),
      avgTicketCents: td.count ? Math.round(td.total / td.count) : 0,
      grossProfitCents: can(role, "costs:read") ? net(td) - td.cost : null,
      yesterdayTotalCents: net(day(shiftDate(today, -1))),
      onlineCount: td.online_count,
      onlineTotalCents: td.online_total,
    },
    orders: ord.enabled || ord.open ? { pending: ord.pending, open: ord.open } : null,
    days: Array.from({ length: 7 }, (_, i) => {
      const d = day(shiftDate(today, i - 6));
      return { date: d.date, totalCents: net(d), count: d.count };
    }),
    topProducts: (topRes!.results as Array<Record<string, unknown>>).map((r) => ({
      productId: r.product_id as string,
      name: r.name as string,
      options: JSON.parse(r.options as string) as string[],
      unit: r.unit as UnitCode,
      quantity: fromMilli(r.qty as number),
      totalCents: r.total as number,
    })),
    openSessions: (sessionsRes!.results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      locationName: (r.location_name as string | null) ?? "—",
      openedBy: r.opened_by_name as string | null,
      openedAt: r.opened_at as string,
    })),
  };
  return c.json(body);
});
