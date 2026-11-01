/**
 * Custom store domains through Cloudflare for SaaS (custom hostnames on the platform's zone).
 * The customer adds a CNAME to STORE_CNAME_TARGET; Cloudflare validates it and issues the certificate.
 */
import { eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import type { StoreDomain } from "@nexo/shared";
import type { Env } from "../env";
import { AppError } from "./errors";

export const domainsConfigured = (env: Env) => Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID);

export const cnameTarget = (env: Env) => env.STORE_CNAME_TARGET ?? new URL(env.STORE_URL).hostname;

interface CustomHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; validation_records?: Array<{ txt_name?: string; txt_value?: string; http_url?: string; http_body?: string }>; validation_errors?: Array<{ message: string }> };
  ownership_verification?: { type: string; name: string; value: string };
  verification_errors?: string[];
}

async function cf<T>(env: Env, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (!domainsConfigured(env)) throw new AppError(503, "domains_not_configured", "Los dominios propios aún no están disponibles en la plataforma.");
  const base = (env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/zones/${env.CF_ZONE_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error("[domains] network", err);
    throw new AppError(502, "cloudflare_unavailable", "No pudimos conectar con Cloudflare. Intenta de nuevo en un momento.");
  }
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: Array<{ code: number; message: string }> };
  if (!res.ok || data.success === false) {
    const message = data.errors?.[0]?.message ?? `HTTP ${res.status}`;
    if (method === "DELETE" && res.status === 404) return {} as T;
    if (/already exists|duplicate/i.test(message)) throw new AppError(409, "domain_taken", "Ese dominio ya está registrado en otra cuenta.", { hostname: "Dominio ya registrado" });
    console.error("[domains]", method, path, message);
    throw new AppError(502, "cloudflare_error", `Cloudflare rechazó la operación: ${message}`);
  }
  return data.result as T;
}

function toRow(h: CustomHostname) {
  const verification: Array<{ type: string; name: string; value: string }> = [];
  if (h.ownership_verification && h.status !== "active") verification.push({ type: h.ownership_verification.type.toUpperCase(), name: h.ownership_verification.name, value: h.ownership_verification.value });
  for (const r of h.ssl?.validation_records ?? []) {
    if (r.txt_name && r.txt_value) verification.push({ type: "TXT", name: r.txt_name, value: r.txt_value });
  }
  const sslStatus = h.ssl?.status ?? null;
  const active = h.status === "active" && sslStatus === "active";
  const failed = /blocked|moved|deleted/.test(h.status) || /timed_out|failed/.test(sslStatus ?? "");
  return {
    cfId: h.id,
    status: active ? ("active" as const) : failed ? ("failed" as const) : ("pending" as const),
    sslStatus,
    verification,
    lastError: h.verification_errors?.[0] ?? h.ssl?.validation_errors?.[0]?.message ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export async function addDomain(env: Env, tenantId: string, hostname: string) {
  const db = controlDb(env.DB_CONTROL);
  const taken = await db.select({ tenantId: control.tenantDomains.tenantId }).from(control.tenantDomains).where(eq(control.tenantDomains.hostname, hostname)).get();
  if (taken) throw new AppError(409, "domain_taken", taken.tenantId === tenantId ? "Ya agregaste este dominio." : "Ese dominio ya está registrado en otra cuenta.", { hostname: "Dominio ya registrado" });
  if (hostname === new URL(env.STORE_URL).hostname || hostname === new URL(env.APP_URL).hostname || hostname === cnameTarget(env)) {
    throw new AppError(422, "validation_error", "Ese dominio pertenece a la plataforma.", { hostname: "Usa un dominio tuyo" });
  }
  const h = await cf<CustomHostname>(env, "POST", "/custom_hostnames", { hostname, ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } }, custom_metadata: { tenant_id: tenantId } });
  await db.insert(control.tenantDomains).values({ hostname, tenantId, ...toRow(h) });
}

export async function refreshDomain(env: Env, hostname: string) {
  const db = controlDb(env.DB_CONTROL);
  const row = await db.select().from(control.tenantDomains).where(eq(control.tenantDomains.hostname, hostname)).get();
  if (!row?.cfId) return row;
  const h = await cf<CustomHostname>(env, "GET", `/custom_hostnames/${row.cfId}`);
  const next = toRow(h);
  await db.update(control.tenantDomains).set(next).where(eq(control.tenantDomains.hostname, hostname));
  return { ...row, ...next };
}

export async function removeDomain(env: Env, hostname: string) {
  const db = controlDb(env.DB_CONTROL);
  const row = await db.select().from(control.tenantDomains).where(eq(control.tenantDomains.hostname, hostname)).get();
  if (!row) return;
  if (row.cfId && domainsConfigured(env)) await cf(env, "DELETE", `/custom_hostnames/${row.cfId}`);
  await db.delete(control.tenantDomains).where(eq(control.tenantDomains.hostname, hostname));
}

export function toStoreDomain(env: Env, row: typeof control.tenantDomains.$inferSelect): StoreDomain {
  return {
    hostname: row.hostname,
    status: row.status,
    sslStatus: row.sslStatus,
    verification: row.verification ?? [],
    target: cnameTarget(env),
    lastError: row.lastError,
    checkedAt: row.checkedAt,
  };
}

/** Hourly: re-check domains still waiting for DNS or the certificate. */
export async function refreshPendingDomains(env: Env) {
  if (!domainsConfigured(env)) return 0;
  const pending = await controlDb(env.DB_CONTROL).select({ hostname: control.tenantDomains.hostname }).from(control.tenantDomains).where(eq(control.tenantDomains.status, "pending")).limit(50);
  for (const { hostname } of pending) await refreshDomain(env, hostname).catch((e) => console.error("[domains] refresh", hostname, e));
  return pending.length;
}
