/**
 * Text messages through the business's own Twilio account (Phase 12).
 * Numbers go out in E.164: «+…» as typed, or with the business's country code (USD → +1, MXN → +52).
 */
import { eq } from "drizzle-orm";
import { tenant, type TenantDb } from "@nexo/db";
import type { Env } from "../env";
import { AppError } from "./errors";
import { openSecret } from "./secrets";

const { smsSettings } = tenant;
const COUNTRY_BY_CURRENCY: Record<string, string> = { USD: "1", CAD: "1", MXN: "52", COP: "57", PEN: "51", CLP: "56", GTQ: "502", ARS: "54", EUR: "34" };

/** «(305) 555-0142» → «+13055550142». null if it can't be a phone number. */
export function toE164(raw: string, currency: string): string | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  const cc = COUNTRY_BY_CURRENCY[currency.toUpperCase()] ?? "1";
  if (cc === "1" && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+${cc}${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

const base = (env: Env) => (env.TWILIO_API_BASE ?? "https://api.twilio.com").replace(/\/$/, "");
const auth = (sid: string, token: string) => `Basic ${btoa(`${sid}:${token}`)}`;

/** Checks the account sid and token with Twilio (no message is sent). */
export async function verifyTwilio(env: Env, sid: string, token: string) {
  const res = await fetch(`${base(env)}/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, { headers: { authorization: auth(sid, token) } }).catch(() => null);
  if (!res) throw new AppError(502, "sms_unreachable", "No pudimos comunicarnos con Twilio. Intenta de nuevo.");
  if (res.status === 401 || res.status === 404) throw new AppError(422, "validation_error", "Twilio no reconoció esas llaves", { authToken: "Revisa el Account SID y el Auth Token" });
  if (!res.ok) throw new AppError(502, "sms_error", "Twilio respondió con un error. Intenta de nuevo.");
}

export async function smsConfig(db: TenantDb, tenantId: string) {
  return (await db.select().from(smsSettings).where(eq(smsSettings.tenantId, tenantId)).get()) ?? null;
}

/** Sends one message. Twilio splits long texts; keep them short (receipts are summarized). */
export async function sendSms(env: Env, db: TenantDb, tenantId: string, to: string, body: string) {
  const cfg = await smsConfig(db, tenantId);
  if (!cfg) throw new AppError(409, "sms_not_configured", "Configura Twilio en Configuración › Integraciones para enviar mensajes.");
  const token = await openSecret(env, tenantId, cfg.authTokenEnc);
  const form = new URLSearchParams({ To: to, Body: body });
  if (cfg.sender.startsWith("MG")) form.set("MessagingServiceSid", cfg.sender);
  else form.set("From", cfg.sender);
  const res = await fetch(`${base(env)}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: auth(cfg.accountSid, token), "content-type": "application/x-www-form-urlencoded" },
    body: form,
  }).catch(() => null);
  if (!res) throw new AppError(502, "sms_unreachable", "No pudimos comunicarnos con Twilio. Intenta de nuevo.");
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
    // 21211/21614: invalid or non-mobile number.
    if (err?.code === 21211 || err?.code === 21614) throw new AppError(422, "validation_error", "Ese teléfono no puede recibir mensajes", { phone: "Revisa el número" });
    throw new AppError(502, "sms_error", `Twilio no envió el mensaje${err?.message ? `: ${err.message}` : ""}.`);
  }
  return (await res.json()) as { sid: string; status: string };
}
