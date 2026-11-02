/**
 * Advertising pixels (Phase 9): Meta, Google tag (GA4 / Ads / Tag Manager) and TikTok.
 * Nothing loads until the customer accepts cookies in the banner (choice saved per store).
 * Events mirror the store's own cookieless ones, plus "purchase" when an order is placed.
 */
import type { StorePixels } from "@nexo/shared";

export type PixelEvent = "page_view" | "product_view" | "add_to_cart" | "checkout_start" | "purchase";
export interface PixelData { id?: string; name?: string; valueCents?: number }
export type Consent = "granted" | "denied" | null;

type Fn = ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...a: unknown[]) => void; loaded?: boolean; version?: string; push?: unknown };
type W = Window & { fbq?: Fn; _fbq?: Fn; dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void; ttq?: Record<string, unknown> & unknown[] };
const w = () => window as W;

const consentKey = (slug: string) => `nx-consent:${slug}`;
export function readConsent(slug: string): Consent {
  try { const v = localStorage.getItem(consentKey(slug)); return v === "granted" || v === "denied" ? v : null; } catch { return null; }
}
export function saveConsent(slug: string, v: Exclude<Consent, null>) {
  try { localStorage.setItem(consentKey(slug), v); } catch { /* private mode: asks again next visit */ }
}

let active: StorePixels | null = null;
let currency = "MXN";

function script(src: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/** Loads the configured pixels once (call only with consent). */
export function startPixels(p: StorePixels, cur: string) {
  if (active) return;
  active = p;
  currency = cur;
  const win = w();
  if (p.metaPixelId) {
    const fbq: Fn = function (...args: unknown[]) { if (fbq.callMethod) fbq.callMethod(...args); else fbq.queue!.push(args); } as Fn;
    fbq.queue = []; fbq.loaded = true; fbq.version = "2.0"; fbq.push = fbq;
    win.fbq = win._fbq = win.fbq ?? fbq;
    script("https://connect.facebook.net/en_US/fbevents.js");
    win.fbq!("init", p.metaPixelId);
  }
  if (p.googleTagId) {
    win.dataLayer = win.dataLayer ?? [];
    if (p.googleTagId.startsWith("GTM-")) {
      win.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
      script(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(p.googleTagId)}`);
    } else {
      // eslint-disable-next-line prefer-rest-params
      win.gtag = function () { win.dataLayer!.push(arguments); };
      win.gtag("js", new Date());
      win.gtag("config", p.googleTagId, { send_page_view: false });
      script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(p.googleTagId)}`);
    }
  }
  if (p.tiktokPixelId) {
    const ttq = (win.ttq = (win.ttq ?? []) as W["ttq"] & Record<string, unknown>)!;
    const methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
    for (const m of methods) ttq[m] = (...args: unknown[]) => { (ttq as unknown[]).push([m, ...args]); };
    (window as unknown as { TiktokAnalyticsObject: string }).TiktokAnalyticsObject = "ttq";
    const src = "https://analytics.tiktok.com/i18n/pixel/events.js";
    Object.assign(ttq, { _i: { [p.tiktokPixelId]: Object.assign([], { _u: src }) }, _t: { [p.tiktokPixelId]: Date.now() }, _o: { [p.tiktokPixelId]: {} } });
    script(`${src}?sdkid=${encodeURIComponent(p.tiktokPixelId)}&lib=ttq`);
  }
}

const META: Record<PixelEvent, string> = { page_view: "PageView", product_view: "ViewContent", add_to_cart: "AddToCart", checkout_start: "InitiateCheckout", purchase: "Purchase" };
const GOOGLE: Record<PixelEvent, string> = { page_view: "page_view", product_view: "view_item", add_to_cart: "add_to_cart", checkout_start: "begin_checkout", purchase: "purchase" };
const TIKTOK: Record<PixelEvent, string> = { page_view: "", product_view: "ViewContent", add_to_cart: "AddToCart", checkout_start: "InitiateCheckout", purchase: "CompletePayment" };

/** Sends one event to every active pixel. Never throws. */
export function pixelEvent(type: PixelEvent, d: PixelData = {}) {
  const p = active;
  if (!p) return;
  try {
    const win = w();
    const value = d.valueCents !== undefined ? Math.round(d.valueCents) / 100 : undefined;
    const money = value !== undefined ? { value, currency } : {};
    if (p.metaPixelId && win.fbq) {
      if (type === "page_view") win.fbq("track", "PageView");
      else win.fbq("track", META[type], { ...money, ...(d.id && { content_ids: [d.id], content_type: "product" }), ...(d.name && { content_name: d.name }) });
    }
    if (p.googleTagId) {
      const params = type === "page_view"
        ? { page_location: window.location.href, page_title: document.title }
        : { ...money, ...(type === "purchase" && d.id ? { transaction_id: d.id } : {}), ...(d.id && type !== "purchase" ? { items: [{ item_id: d.id, item_name: d.name }] } : {}) };
      if (p.googleTagId.startsWith("GTM-")) win.dataLayer?.push({ event: GOOGLE[type], ...params });
      else win.gtag?.("event", GOOGLE[type], params);
    }
    if (p.tiktokPixelId && win.ttq) {
      const ttq = win.ttq as unknown as Record<string, (...a: unknown[]) => void>;
      if (type === "page_view") ttq.page!();
      else ttq.track!(TIKTOK[type], { ...money, ...(d.id && { content_id: d.id, content_type: "product" }) });
    }
  } catch {
    /* a pixel must never break the store */
  }
}
