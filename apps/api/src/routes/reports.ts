import { Hono } from "hono";
import { z } from "zod";
import { ANALYTICS_MAX_DAYS, businessDate, can, daysBetween, fromMilli, paymentLabel, type DashboardData, type InventoryReport, type SalesReport, type StoreAnalytics, type UnitCode } from "@nexo/shared";
import { storeSales, storeTraffic } from "../lib/storeAnalytics";
import type { AppEnv } from "../env";
import { getSettings } from "../lib/sales";
import { requirePermission } from "../middleware/auth";

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Home dashboard: reads the daily summary tables, never scans all sales. */
export const reportRoutes = new Hono<AppEnv>()
  .get("/dashboard", requirePermission("sales:read"), async (c) => {
  const { d1, tenant: t, role } = c.var.auth;
  const settings = await getSettings(c);
  const today = businessDate(settings.timezone);
  const from = shiftDate(today, -6);
  const [daysRes, topRes, sessionsRes, ordersRes] = await d1.batch([
    d1
      .prepare(
        `SELECT date, SUM(sales_count) AS count, SUM(total_cents) AS total, SUM(returns_cents) AS returns, SUM(cost_cents) AS cost, SUM(tax_cents) AS tax, SUM(online_count) AS online_count, SUM(online_total_cents) AS online_total
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
  type Day = { date: string; count: number; total: number; returns: number; cost: number; tax: number; online_count: number; online_total: number };
  const byDate = new Map((daysRes!.results as Day[]).map((d) => [d.date, d]));
  const day = (date: string) => byDate.get(date) ?? { date, count: 0, total: 0, returns: 0, cost: 0, tax: 0, online_count: 0, online_total: 0 };
  const td = day(today);
  const net = (d: Day) => d.total - d.returns;
  const body: DashboardData = {
    today,
    sales: {
      count: td.count,
      totalCents: net(td),
      avgTicketCents: td.count ? Math.round(td.total / td.count) : 0,
      // Profit without taxes: they are not income of the business.
      grossProfitCents: can(role, "costs:read") ? net(td) - td.tax - td.cost : null,
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
})

  /* ---------- Online store: traffic, conversion and sales (Phase 10) ---------- */
  .get("/store", requirePermission("reports:read"), async (c) => {
    const query = z.object({ from: z.string().regex(DATE), to: z.string().regex(DATE) }).safeParse(c.req.query());
    if (!query.success) return c.json({ error: { code: "validation_error", message: "Fechas no válidas" } }, 400);
    const { from, to } = query.data;
    if (to < from) return c.json({ error: { code: "validation_error", message: "El periodo termina antes de empezar" } }, 400);
    const length = daysBetween(from, to);
    if (length > ANALYTICS_MAX_DAYS) return c.json({ error: { code: "validation_error", message: `Elige un periodo de hasta ${ANALYTICS_MAX_DAYS} días (las visitas se guardan 3 meses).` } }, 400);
    const { d1, tenant: t } = c.var.auth;
    const settings = await getSettings(c);
    const sales = await storeSales(d1, t.id, settings.timezone, from, to);
    const traffic = await storeTraffic(c.env, t.id, settings.timezone, sales.range, sales.previous);
    const tr = traffic.traffic;

    // Products: the best sellers plus the most viewed, with names for the ones that only have views.
    const sold = new Map(sales.products.map((p) => [p.id, p]));
    const ids = [...new Set([...sold.keys(), ...[...traffic.products.keys()].slice(0, 100)])];
    const missing = ids.filter((id) => !sold.has(id));
    const names = new Map<string, string>();
    for (let i = 0; i < missing.length; i += 90) {
      const part = missing.slice(i, i + 90);
      const { results } = await d1.prepare(`SELECT id, name FROM products WHERE tenant_id = ?1 AND id IN (${part.map((_, k) => `?${k + 2}`).join(",")})`).bind(t.id, ...part).all<{ id: string; name: string }>();
      results.forEach((r) => names.set(r.id, r.name));
    }
    const products: StoreAnalytics["products"] = ids
      .filter((id) => sold.has(id) || names.has(id))
      .map((id) => {
        const s = sold.get(id);
        const v = traffic.products.get(id);
        return {
          productId: id,
          name: s?.name ?? names.get(id)!,
          quantity: s ? fromMilli(s.qty) : 0,
          orders: s?.n ?? 0,
          salesCents: s?.total ?? 0,
          views: tr.available ? (v?.views ?? 0) : null,
          addToCart: tr.available ? (v?.addToCart ?? 0) : null,
        };
      })
      .sort((a, b) => b.salesCents - a.salesCents || (b.views ?? 0) - (a.views ?? 0));

    const liveOrders = sales.summary.orders - sales.summary.cancelled;
    const prevOrders = sales.summary.previousOrders;
    const body: StoreAnalytics = {
      from,
      to,
      previousFrom: shiftDate(from, -length),
      previousTo: shiftDate(from, -1),
      traffic: tr,
      sales: sales.summary,
      conversionPct: tr.available && tr.visitors ? Math.min(100, (liveOrders / tr.visitors) * 100) : null,
      previousConversionPct: tr.available && tr.previousVisitors ? Math.min(100, (prevOrders / tr.previousVisitors) * 100) : null,
      days: Array.from({ length }, (_, i) => {
        const date = shiftDate(from, i);
        const s = sales.days.get(date);
        const v = traffic.days.get(date);
        return { date, visitors: tr.available ? (v?.visitors ?? 0) : null, views: tr.available ? (v?.views ?? 0) : null, orders: s?.orders ?? 0, salesCents: s?.salesCents ?? 0 };
      }),
      products,
    };
    return c.json(body);
  })

  /* ---------- Sales for a period ---------- */
  .get("/sales", requirePermission("reports:read"), async (c) => {
    const query = z.object({ from: z.string().regex(DATE), to: z.string().regex(DATE) }).parse(c.req.query());
    if (query.to < query.from) return c.json({ error: { code: "validation_error", message: "El periodo termina antes de empezar" } }, 400);
    const { d1, tenant: t, role } = c.var.auth;
    const settings = await getSettings(c);
    const showCost = can(role, "costs:read");
    const { from, to } = query;
    const length = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
    const prevTo = shiftDate(from, -1);
    const prevFrom = shiftDate(from, -length);
    const offset = tzOffsetMinutes(settings.timezone, new Date(`${from}T12:00:00Z`));
    const local = `strftime('%H', s.created_at, '${offset >= 0 ? "+" : ""}${offset} minutes')`;
    const [totalsRes, prevRes, daysRes, promoRes, productsRes, payRes, orderPayRes, changeRes, cashierRes, hoursRes, couponRes] = await d1.batch([
      d1.prepare(`SELECT COALESCE(SUM(sales_count), 0) AS count, COALESCE(SUM(total_cents), 0) AS total, COALESCE(SUM(discount_cents), 0) AS discount, COALESCE(SUM(tax_cents), 0) AS tax,
          COALESCE(SUM(cost_cents), 0) AS cost, COALESCE(SUM(returns_cents), 0) AS returns, COALESCE(SUM(voided_count), 0) AS voided,
          COALESCE(SUM(online_count), 0) AS online_count, COALESCE(SUM(online_total_cents), 0) AS online_total
        FROM daily_sales WHERE tenant_id = ?1 AND date BETWEEN ?2 AND ?3`).bind(t.id, from, to),
      d1.prepare("SELECT COALESCE(SUM(sales_count), 0) AS count, COALESCE(SUM(total_cents - returns_cents), 0) AS net FROM daily_sales WHERE tenant_id = ?1 AND date BETWEEN ?2 AND ?3").bind(t.id, prevFrom, prevTo),
      d1.prepare("SELECT date, SUM(sales_count) AS count, SUM(total_cents - returns_cents) AS net FROM daily_sales WHERE tenant_id = ?1 AND date BETWEEN ?2 AND ?3 GROUP BY date").bind(t.id, from, to),
      d1.prepare(`SELECT (SELECT COALESCE(SUM(promo_discount_cents), 0) FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND business_date BETWEEN ?2 AND ?3)
          + (SELECT COALESCE(SUM(discount_cents), 0) FROM orders WHERE tenant_id = ?1 AND status = 'completed' AND business_date BETWEEN ?2 AND ?3) AS promo`).bind(t.id, from, to),
      d1.prepare(`SELECT d.variant_id, d.product_id, p.name, p.category_id, COALESCE(c.name, 'Sin categoría') AS category, v.options, v.sku, p.unit,
          COALESCE(tr.rate_bps, (SELECT rate_bps FROM tax_rates WHERE tenant_id = ?1 AND is_default = 1 LIMIT 1), 0) AS rate,
          SUM(d.quantity) AS qty, SUM(d.total_cents) AS total, SUM(d.cost_cents) AS cost
        FROM daily_product_sales d JOIN products p ON p.id = d.product_id JOIN variants v ON v.id = d.variant_id
        LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
        WHERE d.tenant_id = ?1 AND d.date BETWEEN ?2 AND ?3 GROUP BY d.variant_id ORDER BY total DESC`).bind(t.id, from, to),
      d1.prepare(`SELECT p.method, COUNT(DISTINCT p.sale_id) AS n, SUM(p.amount_cents) AS amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id
        WHERE s.tenant_id = ?1 AND s.status = 'completed' AND s.business_date BETWEEN ?2 AND ?3 GROUP BY p.method`).bind(t.id, from, to),
      d1.prepare(`SELECT COALESCE(paid_method, 'other') AS method, COUNT(*) AS n, SUM(total_cents) AS amount FROM orders
        WHERE tenant_id = ?1 AND status = 'completed' AND business_date BETWEEN ?2 AND ?3 GROUP BY paid_method`).bind(t.id, from, to),
      d1.prepare("SELECT COALESCE(SUM(change_cents), 0) AS change FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND business_date BETWEEN ?2 AND ?3").bind(t.id, from, to),
      d1.prepare(`SELECT user_id, COALESCE(user_name, '—') AS name, COUNT(*) AS n, SUM(total_cents - refunded_cents) AS net, SUM(discount_cents - promo_discount_cents) AS discount
        FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND business_date BETWEEN ?2 AND ?3 GROUP BY user_id ORDER BY net DESC`).bind(t.id, from, to),
      d1.prepare(`SELECT CAST(${local} AS INTEGER) AS hour, COUNT(*) AS n, SUM(s.total_cents - s.refunded_cents) AS net FROM sales s
        WHERE s.tenant_id = ?1 AND s.status = 'completed' AND s.business_date BETWEEN ?2 AND ?3 GROUP BY hour`).bind(t.id, from, to),
      d1.prepare(`SELECT coupon_code AS code, COUNT(*) AS n, SUM(total) AS total FROM (
          SELECT coupon_code, total_cents - refunded_cents AS total FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND coupon_code IS NOT NULL AND business_date BETWEEN ?2 AND ?3
          UNION ALL SELECT coupon_code, total_cents FROM orders WHERE tenant_id = ?1 AND status = 'completed' AND coupon_code IS NOT NULL AND business_date BETWEEN ?2 AND ?3
        ) GROUP BY coupon_code ORDER BY n DESC`).bind(t.id, from, to),
    ]);
    const tot = totalsRes!.results[0] as Record<string, number>;
    const net = tot.total! - tot.returns!;
    // Line totals always include tax (whatever the pricing setting): take it out to get revenue.
    const exTax = (total: number, rate: number) => Math.round((total * 10_000) / (10_000 + rate));
    const products = (productsRes!.results as Array<Record<string, unknown>>)
      .filter((r) => (r.qty as number) !== 0 || (r.total as number) !== 0)
      .map((r) => {
        const revenue = exTax(r.total as number, r.rate as number);
        return {
          productId: r.product_id as string,
          variantId: r.variant_id as string,
          name: r.name as string,
          options: JSON.parse(r.options as string) as string[],
          sku: r.sku as string,
          unit: r.unit as UnitCode,
          quantity: fromMilli(r.qty as number),
          netCents: r.total as number,
          costCents: showCost ? (r.cost as number) : null,
          profitCents: showCost ? revenue - (r.cost as number) : null,
          categoryId: r.category_id as string | null,
          category: r.category as string,
        };
      });
    const categories = new Map<string, SalesReport["categories"][number]>();
    for (const p of products) {
      const key = p.categoryId ?? "none";
      const cat = categories.get(key) ?? { categoryId: p.categoryId, name: p.category, quantity: 0, netCents: 0, profitCents: showCost ? 0 : null };
      cat.quantity += p.quantity;
      cat.netCents += p.netCents;
      if (cat.profitCents !== null && p.profitCents !== null) cat.profitCents += p.profitCents;
      categories.set(key, cat);
    }
    const payments = new Map<string, { method: string; label: string; count: number; amountCents: number }>();
    const addPay = (method: string, n: number, amount: number) => {
      const p = payments.get(method) ?? { method, label: paymentLabel(method), count: 0, amountCents: 0 };
      p.count += n;
      p.amountCents += amount;
      payments.set(method, p);
    };
    (payRes!.results as Array<{ method: string; n: number; amount: number }>).forEach((p) => addPay(p.method, p.n, p.amount));
    (orderPayRes!.results as Array<{ method: string; n: number; amount: number }>).forEach((p) => addPay(p.method, p.n, p.amount));
    const change = (changeRes!.results[0] as { change: number }).change;
    if (payments.has("cash")) payments.get("cash")!.amountCents -= change;
    const days = new Map((daysRes!.results as Array<{ date: string; count: number; net: number }>).map((d) => [d.date, d]));
    const body: SalesReport = {
      from,
      to,
      totals: {
        count: tot.count!,
        grossCents: tot.total! + tot.discount!,
        discountCents: tot.discount!,
        promoDiscountCents: (promoRes!.results[0] as { promo: number }).promo,
        returnsCents: tot.returns!,
        netCents: net,
        taxCents: tot.tax!,
        costCents: showCost ? tot.cost! : null,
        profitCents: showCost ? net - tot.tax! - tot.cost! : null,
        avgTicketCents: tot.count ? Math.round(tot.total! / tot.count) : 0,
        onlineCount: tot.online_count!,
        onlineCents: tot.online_total!,
        voidedCount: tot.voided!,
      },
      previous: { netCents: (prevRes!.results[0] as { net: number }).net, count: (prevRes!.results[0] as { count: number }).count },
      days: Array.from({ length: Math.min(length, 400) }, (_, i) => {
        const date = shiftDate(from, i);
        const d = days.get(date);
        return { date, netCents: d?.net ?? 0, count: d?.count ?? 0 };
      }),
      products: products.map(({ categoryId: _c, category: _n, ...p }) => p),
      categories: [...categories.values()].sort((a, b) => b.netCents - a.netCents),
      payments: [...payments.values()].sort((a, b) => b.amountCents - a.amountCents),
      cashiers: [
        ...(cashierRes!.results as Array<Record<string, unknown>>).map((r) => ({ userId: r.user_id as string | null, name: r.name as string, count: r.n as number, netCents: r.net as number, discountCents: r.discount as number })),
        ...(tot.online_count ? [{ userId: null, name: "Tienda en línea", count: tot.online_count, netCents: tot.online_total!, discountCents: 0 }] : []),
      ],
      hours: Array.from({ length: 24 }, (_, hour) => {
        const h = (hoursRes!.results as Array<{ hour: number; n: number; net: number }>).find((x) => x.hour === hour);
        return { hour, count: h?.n ?? 0, netCents: h?.net ?? 0 };
      }),
      coupons: (couponRes!.results as Array<{ code: string; n: number; total: number }>).map((r) => ({ code: r.code, uses: r.n, salesCents: r.total })),
    };
    return c.json(body);
  })

  /* ---------- Inventory: value by category and products that do not move ---------- */
  .get("/inventory", requirePermission("reports:read"), async (c) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(60) }).parse(c.req.query());
    const { d1, tenant: t, role } = c.var.auth;
    if (!can(role, "costs:read")) return c.json({ error: { code: "forbidden", message: "No tienes permiso para esta acción" } }, 403);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const [valRes, staleRes] = await d1.batch([
      d1.prepare(`SELECT p.category_id, COALESCE(c.name, 'Sin categoría') AS name, SUM(sl.quantity) AS qty, SUM(sl.quantity * v.cost_cents) AS cost_milli, SUM(sl.quantity * v.price_cents) AS retail_milli
        FROM stock_levels sl JOIN variants v ON v.id = sl.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE sl.tenant_id = ?1 AND sl.quantity > 0 AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.track_inventory = 1
        GROUP BY p.category_id ORDER BY cost_milli DESC`).bind(t.id),
      d1.prepare(`SELECT * FROM (
          SELECT v.id AS variant_id, p.id AS product_id, p.name, v.options, p.unit, v.cost_cents, st.qty,
            (SELECT MAX(s.created_at) FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.variant_id = v.id AND s.status = 'completed') AS last_sale,
            (SELECT MAX(o.created_at) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.variant_id = v.id AND o.status <> 'cancelled') AS last_order
          FROM variants v JOIN products p ON p.id = v.product_id
          JOIN (SELECT variant_id, SUM(quantity) AS qty FROM stock_levels WHERE tenant_id = ?1 GROUP BY variant_id) st ON st.variant_id = v.id
          WHERE v.tenant_id = ?1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'active' AND p.track_inventory = 1 AND st.qty > 0 AND p.created_at < ?2
        ) WHERE MAX(COALESCE(last_sale, ''), COALESCE(last_order, '')) < ?2
        ORDER BY qty * cost_cents DESC LIMIT 100`).bind(t.id, cutoff),
    ]);
    const valuation = (valRes!.results as Array<Record<string, number | string | null>>).map((r) => ({
      categoryId: r.category_id as string | null,
      name: r.name as string,
      units: fromMilli(r.qty as number),
      costCents: Math.round((r.cost_milli as number) / 1000),
      retailCents: Math.round((r.retail_milli as number) / 1000),
    }));
    const body: InventoryReport = {
      valuation,
      totalCostCents: valuation.reduce((a, v) => a + v.costCents, 0),
      totalRetailCents: valuation.reduce((a, v) => a + v.retailCents, 0),
      stale: (staleRes!.results as Array<Record<string, unknown>>).map((r) => {
        const last = [r.last_sale as string | null, r.last_order as string | null].filter(Boolean).sort().pop() ?? null;
        return {
          productId: r.product_id as string,
          variantId: r.variant_id as string,
          name: r.name as string,
          options: JSON.parse(r.options as string) as string[],
          unit: r.unit as UnitCode,
          stock: fromMilli(r.qty as number),
          costCents: Math.round(((r.qty as number) * (r.cost_cents as number)) / 1000),
          lastSaleAt: last,
        };
      }),
      days,
    };
    return c.json(body);
  });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Minutes to add to UTC to get the local time of a time zone at a given instant. */
function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((local - at.getTime()) / 60_000);
}
