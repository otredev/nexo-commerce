/**
 * Minimal Stripe client over fetch (no SDK: smaller Worker, and tests point STRIPE_API_BASE to a mock).
 * Stripe takes form-encoded bodies with bracket notation: line_items[0][price]=…
 */
import type { Env } from "../env";
import { AppError } from "./errors";
import { timingSafeEqual } from "./crypto";

export const stripeConfigured = (env: Env) => Boolean(env.STRIPE_SECRET_KEY);

type Params = Record<string, unknown>;

export function formEncode(params: Params, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") out.push(...formEncode(item as Params, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      out.push(...formEncode(v as Params, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

export interface StripeOptions {
  /** Act on a connected account (Stripe-Account header). */
  account?: string | null;
  idempotencyKey?: string;
}

export async function stripe<T = Record<string, unknown>>(env: Env, method: "GET" | "POST" | "DELETE", path: string, params?: Params, opts: StripeOptions = {}): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new AppError(503, "stripe_not_configured", "Los pagos con Stripe aún no están configurados en la plataforma.");
  const base = (env.STRIPE_API_BASE ?? "https://api.stripe.com").replace(/\/$/, "");
  const body = params ? formEncode(params).join("&") : "";
  const url = `${base}/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (opts.account) headers["Stripe-Account"] = opts.account;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: method === "POST" ? body : undefined });
  } catch (err) {
    console.error("[stripe] network", path, err);
    throw new AppError(502, "stripe_unavailable", "No pudimos conectar con Stripe. Intenta de nuevo en un momento.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) {
    console.error("[stripe]", method, path, res.status, data.error?.message);
    throw new AppError(502, "stripe_error", `Stripe rechazó la operación${data.error?.message ? `: ${data.error.message}` : "."}`);
  }
  return data;
}

/* ---------- Webhook signature (Stripe-Signature: t=…,v1=…) ---------- */

const TOLERANCE_SECONDS = 300;
const enc = new TextEncoder();

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when the body was signed with one of the secrets in the last 5 minutes. */
export async function verifyStripeSignature(body: string, header: string | undefined, secrets: Array<string | undefined>, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !signatures.length || Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return false;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = enc.encode(await hmacHex(secret, `${t}.${body}`));
    if (signatures.some((s) => timingSafeEqual(enc.encode(s), expected))) return true;
  }
  return false;
}

/** For tests and the local mock: builds a valid header. */
export async function signStripePayload(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}
