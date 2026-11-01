import type { Context } from "hono";
import { tenant } from "@nexo/db";
import type { AppEnv } from "../env";
import { newId } from "./crypto";

export interface AuditInput {
  action: string; // e.g. "settings.update", "user.create"
  entity: string; // e.g. "business_settings", "user"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Returns the audit INSERT as a query builder so callers can put it in the same db.batch()
 * as the change itself: the change and its audit entry commit together or not at all.
 */
export function auditEntry(c: Context<AppEnv>, input: AuditInput) {
  const { auth } = c.var;
  return auth.db.insert(tenant.auditLog).values({
    id: newId(),
    tenantId: auth.tenant.id,
    userId: auth.user.id,
    userName: auth.user.name,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
}

/** Shallow diff: keeps only the keys that changed, so the log stays readable. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
