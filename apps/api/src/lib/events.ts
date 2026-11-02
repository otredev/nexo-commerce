/**
 * Store traffic, without cookies: each event is one data point in Workers Analytics Engine
 * (binding STORE_EVENTS; without it, nothing is recorded). The visitor is a hash of the day, IP and
 * browser that changes every day and never stores the IP — enough to count unique visitors per day.
 *
 * Layout (Phase 10 queries it with SQL): index1 = tenant id;
 * blobs = [type, path, referrer host, country, device, product id, visitor, utm source, utm medium, utm campaign];
 * doubles = [1, amount in cents (orders)].
 */
import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { sha256Hex } from "./crypto";

export const STORE_EVENT_TYPES = ["page_view", "product_view", "add_to_cart", "checkout_start", "order_placed"] as const;
export type StoreEventType = (typeof STORE_EVENT_TYPES)[number];

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|lighthouse|monitor|curl|wget|python|go-http/i;

export const deviceOf = (ua: string) => (/ipad|tablet/i.test(ua) ? "tablet" : /mobi|android|iphone/i.test(ua) ? "mobile" : "desktop");

export function referrerHost(ref: string | null | undefined, ownHosts: string[]): string {
  if (!ref) return "";
  try {
    const host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
    return ownHosts.includes(host) ? "" : host;
  } catch {
    return "";
  }
}

export interface StoreEvent {
  type: StoreEventType;
  path: string;
  referrer?: string | null;
  productId?: string | null;
  amountCents?: number;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
}

export async function recordStoreEvent(c: Context<AppEnv>, tenantId: string, e: StoreEvent) {
  const ds = c.env.STORE_EVENTS;
  if (!ds) return false;
  const ua = c.req.header("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return false;
  const ip = c.req.header("cf-connecting-ip") ?? "";
  const day = new Date().toISOString().slice(0, 10);
  const visitor = (await sha256Hex(`${day}|${ip}|${ua}|${tenantId}`)).slice(0, 16);
  const country = (c.req.raw as Request & { cf?: { country?: string } }).cf?.country ?? c.req.header("cf-ipcountry") ?? "";
  const ownHosts = [hostOf(c.env.STORE_URL), hostOf(c.req.header("origin"))].filter(Boolean) as string[];
  ds.writeDataPoint({
    indexes: [tenantId],
    blobs: [
      e.type, e.path.slice(0, 200), referrerHost(e.referrer, ownHosts), country, deviceOf(ua), e.productId ?? "", visitor,
      (e.utm?.source ?? "").slice(0, 60), (e.utm?.medium ?? "").slice(0, 60), (e.utm?.campaign ?? "").slice(0, 60),
    ],
    doubles: [1, e.amountCents ?? 0],
  });
  return true;
}

const hostOf = (url: string | null | undefined) => {
  try { return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : null; } catch { return null; }
};

export type { Env };
