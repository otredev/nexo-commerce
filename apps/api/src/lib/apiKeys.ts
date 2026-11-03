/**
 * API keys (Phase 11). Format: "nx_" + 32 random bytes in base64url. Only the SHA-256 is stored.
 * A request with "Authorization: Bearer nx_…" acts as the business with the key's role.
 */
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { API_KEY_ACCESS, effectivePlan, type ApiKey, type ApiKeyAccess } from "@nexo/shared";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import type { LoadedSession } from "./session";

export const KEY_PREFIX = "nx_";

export async function generateApiKey() {
  const key = `${KEY_PREFIX}${randomToken(32)}`;
  return { key, hash: await sha256Hex(key), prefix: key.slice(0, 10) };
}

export const bearerKey = (c: Context<AppEnv>) => {
  const h = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+(nx_[A-Za-z0-9_-]{20,80})\s*$/.exec(h);
  return m ? m[1]! : null;
};

export interface KeySession extends LoadedSession {
  apiKey: { id: string; name: string; access: ApiKeyAccess; readOnly: boolean };
}

/** Resolves a key to the business it belongs to. Null when unknown, revoked, expired or the business is gone. */
export async function loadApiKey(c: Context<AppEnv>, key: string): Promise<KeySession | null> {
  const hash = await sha256Hex(key);
  const db = controlDb(c.env.DB_CONTROL);
  const row = await db
    .select({
      id: control.apiKeys.id, name: control.apiKeys.name, access: control.apiKeys.access, createdBy: control.apiKeys.createdBy,
      expiresAt: control.apiKeys.expiresAt, revokedAt: control.apiKeys.revokedAt, lastUsedAt: control.apiKeys.lastUsedAt,
      tenantId: control.tenants.id, tenantSlug: control.tenants.slug, tenantName: control.tenants.name, tenantStatus: control.tenants.status,
      plan: control.tenants.plan, planStatus: control.tenants.planStatus, suspendedReason: control.tenants.suspendedReason, dbBinding: control.tenants.dbBinding,
    })
    .from(control.apiKeys)
    .innerJoin(control.tenants, eq(control.tenants.id, control.apiKeys.tenantId))
    .where(eq(control.apiKeys.hash, hash))
    .get();
  const now = new Date();
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now.toISOString()) || row.tenantStatus === "provisioning") return null;
  // "Last used" is updated at most every 5 minutes, after the response.
  if (!row.lastUsedAt || now.getTime() - Date.parse(row.lastUsedAt) > 5 * 60_000) {
    const done = db.update(control.apiKeys).set({ lastUsedAt: now.toISOString() }).where(and(eq(control.apiKeys.id, row.id))).run().catch(() => {});
    try { c.executionCtx.waitUntil(done); } catch { await done; }
  }
  const access = API_KEY_ACCESS[row.access];
  return {
    sessionId: `apikey:${row.id}`,
    expiresAt: row.expiresAt ?? "9999-12-31T00:00:00.000Z",
    user: { id: row.createdBy, name: `API · ${row.name}`, email: "" },
    tenant: {
      id: row.tenantId, slug: row.tenantSlug, name: row.tenantName, dbBinding: row.dbBinding,
      status: row.tenantStatus, plan: effectivePlan(row.plan, row.planStatus), suspendedReason: row.suspendedReason,
    },
    role: access.role,
    apiKey: { id: row.id, name: row.name, access: row.access, readOnly: access.readOnly },
  };
}

export const toApiKey = (r: typeof control.apiKeys.$inferSelect): ApiKey => ({
  id: r.id, name: r.name, prefix: r.prefix, access: r.access, createdByName: r.createdByName, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, expiresAt: r.expiresAt,
});
