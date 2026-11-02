/**
 * Online store analytics (Phase 10).
 * - Traffic: Workers Analytics Engine SQL API over the cookieless events of Phase 7 (layout in events.ts:
 *   index1 = tenant, blob1 type, blob2 path, blob3 referrer host, blob4 country, blob5 device, blob6 product,
 *   blob7 daily visitor hash, blob8–10 utm source/medium/campaign, double2 amount). Counts are weighted by
 *   _sample_interval because Analytics Engine samples at high volume. Data is kept 3 months.
 * - Sales: the orders in the business's D1 (exact).
 */
import {
  daysBetween, localRange, shiftDay, tzOffsetMinutes,
  type StoreAnalytics, type StoreSalesSummary, type StoreTraffic,
} from "@nexo/shared";
import type { Env } from "../env";

/* ---------- Analytics Engine ---------- */

export const trafficConfigured = (env: Env) => Boolean(env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN && env.STORE_EVENTS_DATASET);

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_TZ = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

type Row = Record<string, string | number | null>;

async function ae(env: Env, sql: string): Promise<Row[]> {
  const base = (env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
  const res = await fetch(`${base}/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "content-type": "text/plain" },
    body: `${sql} FORMAT JSON`,
  });
  if (!res.ok) throw new Error(`Analytics Engine ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { data?: Row[] };
  return body.data ?? [];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Builds the WHERE clause; every value is validated, so plain interpolation is safe. */
function where(env: Env, tenantId: string, start: Date, end: Date, extra = "") {
  if (!SAFE_ID.test(tenantId)) throw new Error("bad tenant id");
  const s = Math.floor(start.getTime() / 1000);
  const e = Math.floor(end.getTime() / 1000);
  return `FROM ${env.STORE_EVENTS_DATASET} WHERE index1 = '${tenantId}' AND timestamp >= toDateTime(${s}) AND timestamp < toDateTime(${e})${extra ? ` AND ${extra}` : ""}`;
}
const VIEWS = "blob1 IN ('page_view', 'product_view')";

export interface TrafficResult {
  traffic: StoreTraffic;
  days: Map<string, { visitors: number; views: number }>;
  products: Map<string, { views: number; addToCart: number }>;
}

const emptyTraffic = (reason: StoreTraffic["reason"]): StoreTraffic => ({
  available: false, reason, visitors: 0, previousVisitors: 0, pageViews: 0, productViews: 0,
  funnel: { visitors: 0, viewedProduct: 0, addedToCart: 0, startedCheckout: 0, ordered: 0 },
  sources: [], campaigns: [], devices: [], countries: [], pages: [],
});

export async function storeTraffic(env: Env, tenantId: string, timeZone: string, range: [Date, Date], previous: [Date, Date]): Promise<TrafficResult> {
  const none = { days: new Map(), products: new Map() };
  if (!trafficConfigured(env)) return { traffic: emptyTraffic("not_configured"), ...none };
  if (!SAFE_ID.test(env.STORE_EVENTS_DATASET!)) return { traffic: emptyTraffic("not_configured"), ...none };
  const tz = SAFE_TZ.test(timeZone) ? timeZone : "UTC";
  const w = (extra = "") => where(env, tenantId, range[0], range[1], extra);
  try {
    const [total, prev, byType, days, sources, campaigns, devices, countries, pages, products] = await Promise.all([
      ae(env, `SELECT count(DISTINCT blob7) AS visitors ${w()}`),
      ae(env, `SELECT count(DISTINCT blob7) AS visitors ${where(env, tenantId, previous[0], previous[1])}`),
      ae(env, `SELECT blob1 AS type, SUM(_sample_interval) AS events, count(DISTINCT blob7) AS visitors ${w()} GROUP BY type`),
      ae(env, `SELECT formatDateTime(timestamp, '%Y-%m-%d', '${tz}') AS day, SUM(_sample_interval) AS views, count(DISTINCT blob7) AS visitors ${w(VIEWS)} GROUP BY day ORDER BY day`),
      ae(env, `SELECT blob3 AS source, count(DISTINCT blob7) AS visitors ${w(`${VIEWS} AND blob3 != ''`)} GROUP BY source ORDER BY visitors DESC LIMIT 12`),
      ae(env, `SELECT blob8 AS source, blob9 AS medium, blob10 AS campaign, count(DISTINCT blob7) AS visitors ${w(`${VIEWS} AND blob8 != ''`)} GROUP BY source, medium, campaign ORDER BY visitors DESC LIMIT 12`),
      ae(env, `SELECT blob5 AS device, count(DISTINCT blob7) AS visitors ${w(VIEWS)} GROUP BY device ORDER BY visitors DESC`),
      ae(env, `SELECT blob4 AS country, count(DISTINCT blob7) AS visitors ${w(`${VIEWS} AND blob4 != ''`)} GROUP BY country ORDER BY visitors DESC LIMIT 10`),
      ae(env, `SELECT blob2 AS path, SUM(_sample_interval) AS views, count(DISTINCT blob7) AS visitors ${w(VIEWS)} GROUP BY path ORDER BY views DESC LIMIT 12`),
      ae(env, `SELECT blob6 AS product, sumIf(_sample_interval, blob1 = 'product_view') AS views, sumIf(_sample_interval, blob1 = 'add_to_cart') AS carts ${w("blob1 IN ('product_view', 'add_to_cart') AND blob6 != ''")} GROUP BY product ORDER BY views DESC LIMIT 200`),
    ]);
    const type = (t: string) => byType.find((r) => r.type === t);
    const visitors = num(total[0]?.visitors);
    const sourceVisitors = sources.reduce((a, r) => a + num(r.visitors), 0);
    const traffic: StoreTraffic = {
      available: true,
      reason: null,
      visitors,
      previousVisitors: num(prev[0]?.visitors),
      pageViews: num(type("page_view")?.events),
      productViews: num(type("product_view")?.events),
      funnel: {
        visitors,
        viewedProduct: num(type("product_view")?.visitors),
        addedToCart: num(type("add_to_cart")?.visitors),
        startedCheckout: num(type("checkout_start")?.visitors),
        ordered: num(type("order_placed")?.visitors),
      },
      // Only the first page of a visit carries the referrer; everyone else came directly (or it was hidden).
      sources: [
        ...sources.map((r) => ({ source: str(r.source), visitors: num(r.visitors) })),
        ...(visitors > sourceVisitors ? [{ source: "", visitors: visitors - sourceVisitors }] : []),
      ].sort((a, b) => b.visitors - a.visitors),
      campaigns: campaigns.map((r) => ({ source: str(r.source), medium: str(r.medium), campaign: str(r.campaign), visitors: num(r.visitors) })),
      devices: devices.filter((r) => ["mobile", "desktop", "tablet"].includes(str(r.device))).map((r) => ({ device: str(r.device) as "mobile" | "desktop" | "tablet", visitors: num(r.visitors) })),
      countries: countries.map((r) => ({ country: str(r.country), visitors: num(r.visitors) })),
      pages: pages.map((r) => ({ path: str(r.path), views: num(r.views), visitors: num(r.visitors) })),
    };
    return {
      traffic,
      days: new Map(days.map((r) => [str(r.day), { visitors: num(r.visitors), views: num(r.views) }])),
      products: new Map(products.map((r) => [str(r.product), { views: num(r.views), addToCart: num(r.carts) }])),
    };
  } catch (err) {
    console.error("[analytics] traffic query failed", err);
    return { traffic: emptyTraffic("error"), ...none };
  }
}

/* ---------- Sales from the orders ---------- */

const iso = (d: Date) => d.toISOString();

export async function storeSales(d1: D1Database, tenantId: string, timeZone: string, from: string, to: string) {
  const [start, end] = localRange(from, to, timeZone);
  const length = daysBetween(from, to);
  const [pStart, pEnd] = localRange(shiftDay(from, -length), shiftDay(from, -1), timeZone);
  // Local day of each order: a fixed offset for the range (exact except on a DST change day).
  const off = tzOffsetMinutes(timeZone, new Date((start.getTime() + end.getTime()) / 2));
  const localDay = `date(created_at, '${off >= 0 ? "+" : ""}${off} minutes')`;
  const range = "tenant_id = ?1 AND created_at >= ?2 AND created_at < ?3";
  const live = `${range} AND status != 'cancelled'`;
  const [totals, prev, status, pay, ful, coupons, days, products, customers] = await d1.batch([
    d1.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents END), 0) AS sales,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_cents END), 0) AS completed,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN discount_cents END), 0) AS discount,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN shipping_cents END), 0) AS shipping
      FROM orders WHERE ${range}`).bind(tenantId, iso(start), iso(end)),
    d1.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents END), 0) AS sales FROM orders WHERE ${range}`).bind(tenantId, iso(pStart), iso(pEnd)),
    d1.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE ${range} GROUP BY status`).bind(tenantId, iso(start), iso(end)),
    d1.prepare(`SELECT payment_method AS k, COUNT(*) AS n, SUM(total_cents) AS total FROM orders WHERE ${live} GROUP BY payment_method ORDER BY total DESC`).bind(tenantId, iso(start), iso(end)),
    d1.prepare(`SELECT fulfillment AS k, COUNT(*) AS n, SUM(total_cents) AS total FROM orders WHERE ${live} GROUP BY fulfillment ORDER BY total DESC`).bind(tenantId, iso(start), iso(end)),
    d1.prepare(`SELECT coupon_code AS k, COUNT(*) AS n, SUM(discount_cents) AS total FROM orders WHERE ${live} AND coupon_code IS NOT NULL GROUP BY coupon_code ORDER BY n DESC LIMIT 10`).bind(tenantId, iso(start), iso(end)),
    d1.prepare(`SELECT ${localDay} AS day, COUNT(*) AS n, SUM(total_cents) AS total FROM orders WHERE ${live} GROUP BY day`).bind(tenantId, iso(start), iso(end)),
    d1.prepare(`SELECT i.product_id AS id, MAX(i.name) AS name, SUM(i.quantity) AS qty, COUNT(DISTINCT i.order_id) AS n, SUM(i.total_cents) AS total
      FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.tenant_id = ?1 AND o.created_at >= ?2 AND o.created_at < ?3 AND o.status != 'cancelled'
      GROUP BY i.product_id ORDER BY total DESC LIMIT 200`).bind(tenantId, iso(start), iso(end)),
    d1.prepare(`SELECT COUNT(*) AS customers, COALESCE(SUM(seen_before), 0) AS seen_before FROM (
        SELECT lower(o.customer_email) AS email,
          EXISTS (SELECT 1 FROM orders p WHERE p.tenant_id = ?1 AND lower(p.customer_email) = lower(o.customer_email) AND p.created_at < ?2 AND p.status != 'cancelled') AS seen_before
        FROM orders o WHERE o.tenant_id = ?1 AND o.created_at >= ?2 AND o.created_at < ?3 AND o.status != 'cancelled' GROUP BY lower(o.customer_email))`).bind(tenantId, iso(start), iso(end)),
  ]);
  const t = totals!.results[0] as Record<string, number>;
  const p = prev!.results[0] as Record<string, number>;
  const c = customers!.results[0] as Record<string, number>;
  const kv = (r: D1Result) => (r.results as Array<{ k: string; n: number; total: number }>);
  const live_ = t.orders! - t.cancelled!;
  const summary: StoreSalesSummary = {
    orders: t.orders!,
    cancelled: t.cancelled!,
    salesCents: t.sales!,
    completedCents: t.completed!,
    avgOrderCents: live_ ? Math.round(t.sales! / live_) : 0,
    discountCents: t.discount!,
    shippingCents: t.shipping!,
    previousOrders: p.orders!,
    previousSalesCents: p.sales!,
    customers: c.customers ?? 0,
    returningCustomers: c.seen_before ?? 0,
    byStatus: (status!.results as Array<{ status: string; n: number }>).map((r) => ({ status: r.status, orders: r.n })),
    byPayment: kv(pay!).map((r) => ({ method: r.k, orders: r.n, salesCents: r.total })),
    byFulfillment: kv(ful!).map((r) => ({ fulfillment: r.k, orders: r.n, salesCents: r.total })),
    coupons: kv(coupons!).map((r) => ({ code: r.k, orders: r.n, discountCents: r.total })),
  };
  return {
    summary,
    days: new Map((days!.results as Array<{ day: string; n: number; total: number }>).map((r) => [r.day, { orders: r.n, salesCents: r.total }])),
    products: products!.results as Array<{ id: string; name: string; qty: number; n: number; total: number }>,
    range: [start, end] as [Date, Date],
    previous: [pStart, pEnd] as [Date, Date],
  };
}

export type { StoreAnalytics };
