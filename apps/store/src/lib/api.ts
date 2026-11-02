import type { ApiError } from "@nexo/shared";
import { pixelEvent } from "./pixels";

export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

/** Public store API: no cookies, JSON in and out, our error shape. */
export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/store${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new RequestError(0, "network", "No hay conexión. Revisa tu internet e intenta de nuevo.");
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new RequestError(res.status, err?.code ?? "unknown", err?.message ?? "Ocurrió un error inesperado", err?.fields ?? {});
  }
  return data as T;
}

export const imageUrl = (key: string | null | undefined) => (key ? `/files/${key}` : null);

/* ---------- Traffic (no cookies) ---------- */

type TrackType = "page_view" | "product_view" | "add_to_cart" | "checkout_start";
let utm: { source: string | null; medium: string | null; campaign: string | null } | null = null;
let landingReferrer: string | null = typeof document !== "undefined" ? document.referrer || null : null;

/** Fire-and-forget event for the store's traffic report. Never blocks or fails the page. */
export function track(slug: string, type: TrackType, extra: { productId?: string; name?: string; valueCents?: number } = {}) {
  pixelEvent(type, { id: extra.productId, name: extra.name, valueCents: extra.valueCents });
  try {
    if (utm === null) {
      const p = new URLSearchParams(window.location.search);
      utm = { source: p.get("utm_source"), medium: p.get("utm_medium"), campaign: p.get("utm_campaign") };
    }
    const body = JSON.stringify({ type, path: window.location.pathname, referrer: landingReferrer, productId: extra.productId ?? null, utm });
    // Only the first page view carries the external referrer.
    if (type === "page_view" || type === "product_view") landingReferrer = null;
    const url = `/api/store/${encodeURIComponent(slug)}/events`;
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.(url, blob)) void fetch(url, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  } catch {
    /* analytics must never break the store */
  }
}
