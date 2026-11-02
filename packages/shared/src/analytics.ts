/**
 * Online store analytics (Phase 10): traffic (Workers Analytics Engine, cookieless events from Phase 7)
 * and sales (the orders in D1), for a range of business days with the previous period to compare.
 */

export const ANALYTICS_MAX_DAYS = 90;

export interface StoreAnalytics {
  from: string;
  to: string;
  /** Same length, right before. */
  previousFrom: string;
  previousTo: string;
  traffic: StoreTraffic;
  sales: StoreSalesSummary;
  /** Orders per visitor, 0–100 (null without traffic data or visitors). */
  conversionPct: number | null;
  previousConversionPct: number | null;
  days: Array<{ date: string; visitors: number | null; views: number | null; orders: number; salesCents: number }>;
  products: Array<{
    productId: string;
    name: string;
    /** From the orders. */
    quantity: number;
    orders: number;
    salesCents: number;
    /** From the traffic (null without traffic data). */
    views: number | null;
    addToCart: number | null;
  }>;
}

export type TrafficUnavailable = "not_configured" | "error";

export interface StoreTraffic {
  /** False when Analytics Engine is not configured (local, or missing secrets) or the query failed. */
  available: boolean;
  reason: TrafficUnavailable | null;
  visitors: number;
  previousVisitors: number;
  pageViews: number;
  productViews: number;
  /** Unique visitors that reached each step. */
  funnel: { visitors: number; viewedProduct: number; addedToCart: number; startedCheckout: number; ordered: number };
  sources: Array<{ source: string; visitors: number }>;
  campaigns: Array<{ source: string; medium: string; campaign: string; visitors: number }>;
  devices: Array<{ device: "mobile" | "desktop" | "tablet"; visitors: number }>;
  countries: Array<{ country: string; visitors: number }>;
  pages: Array<{ path: string; views: number; visitors: number }>;
}

export interface StoreSalesSummary {
  /** Orders placed in the range (all statuses). */
  orders: number;
  cancelled: number;
  /** Value of the orders that were not cancelled (taxes and shipping included). */
  salesCents: number;
  completedCents: number;
  avgOrderCents: number;
  discountCents: number;
  shippingCents: number;
  previousOrders: number;
  previousSalesCents: number;
  /** Distinct customers (by email) and how many had bought online before the range. */
  customers: number;
  returningCustomers: number;
  byStatus: Array<{ status: string; orders: number }>;
  byPayment: Array<{ method: string; orders: number; salesCents: number }>;
  byFulfillment: Array<{ fulfillment: string; orders: number; salesCents: number }>;
  coupons: Array<{ code: string; orders: number; discountCents: number }>;
}

export const DEVICE_LABELS: Record<string, string> = { mobile: "Celular", desktop: "Computadora", tablet: "Tableta" };

/** Common source hosts → friendly names (the rest show their host). */
export function sourceLabel(host: string): string {
  if (!host) return "Directo o desconocido";
  const h = host.toLowerCase();
  const known: Array<[RegExp, string]> = [
    [/(^|\.)google\./, "Google"],
    [/(^|\.)bing\.com$/, "Bing"],
    [/duckduckgo\.com$/, "DuckDuckGo"],
    [/(^|\.)(facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com)$/, "Facebook"],
    [/(^|\.)instagram\.com$/, "Instagram"],
    [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X (Twitter)"],
    [/(^|\.)tiktok\.com$/, "TikTok"],
    [/(^|\.)(wa\.me|whatsapp\.com|web\.whatsapp\.com)$/, "WhatsApp"],
    [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "YouTube"],
    [/(^|\.)pinterest\./, "Pinterest"],
    [/(^|\.)linkedin\.com$|lnkd\.in$/, "LinkedIn"],
    [/chatgpt\.com$|openai\.com$/, "ChatGPT"],
    [/perplexity\.ai$/, "Perplexity"],
    [/gemini\.google\.com$/, "Gemini"],
  ];
  for (const [re, name] of known) if (re.test(h)) return name;
  return h;
}

/** Number of days in an inclusive YYYY-MM-DD range. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

export function shiftDay(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes to add to UTC to get the local time of a time zone at an instant. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return Math.round((local - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** UTC instant where a local business day starts (handles DST on that day). */
export function localDayStart(date: string, timeZone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const off1 = tzOffsetMinutes(timeZone, new Date(guess));
  const t = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(timeZone, new Date(t));
  return new Date(guess - off2 * 60_000);
}

/** [start, end) UTC instants of an inclusive range of local days. */
export const localRange = (from: string, to: string, timeZone: string): [Date, Date] => [localDayStart(from, timeZone), localDayStart(shiftDay(to, 1), timeZone)];

/** Percentage change, null when there is nothing to compare with. */
export const changePct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
