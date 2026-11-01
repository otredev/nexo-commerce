import { tenantDb, type TenantDb } from "@nexo/db";
import type { Env, TenantRef } from "../env";
import { AppError } from "./errors";

/**
 * THE ONLY WAY to reach a business database.
 * Today every tenant points to DB_TENANT_DEFAULT. When a tenant moves to its own D1,
 * only tenants.db_binding changes (or this function resolves it dynamically) — no route changes.
 */
export function getTenantD1(env: Env, tenant: Pick<TenantRef, "dbBinding">): D1Database {
  const d1 = (env as unknown as Record<string, unknown>)[tenant.dbBinding];
  if (!d1 || typeof (d1 as D1Database).prepare !== "function") {
    throw new AppError(500, "tenant_db_missing", `Database binding ${tenant.dbBinding} is not configured`);
  }
  return d1 as D1Database;
}

export function getTenantDb(env: Env, tenant: Pick<TenantRef, "dbBinding">): { db: TenantDb; d1: D1Database } {
  const d1 = getTenantD1(env, tenant);
  return { db: tenantDb(d1), d1 };
}

/** Lowercase, ASCII, hyphenated slug used for subdomains (casa-olivo.nexo.app). */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "negocio"
  );
}
