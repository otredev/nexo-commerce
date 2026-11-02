import { and, eq, inArray } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import type { StoreIndexEntry } from "@nexo/shared";
import type { Env } from "../env";
import { getTenantD1 } from "./tenant";
import { chunk } from "./inventory";

/**
 * Every public, indexable store of the platform (for the sitemap index of the shared store domain).
 * Businesses live in several D1s: one query per database, then joined with the control DB.
 */
export async function storeIndex(env: Env): Promise<StoreIndexEntry[]> {
  const cdb = controlDb(env.DB_CONTROL);
  const tenants = await cdb
    .select({ id: control.tenants.id, slug: control.tenants.slug, dbBinding: control.tenants.dbBinding })
    .from(control.tenants)
    .where(eq(control.tenants.status, "active"));
  if (!tenants.length) return [];
  const out: StoreIndexEntry[] = [];
  const byBinding = new Map<string, typeof tenants>();
  for (const t of tenants) byBinding.set(t.dbBinding, [...(byBinding.get(t.dbBinding) ?? []), t]);
  for (const [binding, list] of byBinding) {
    let d1: D1Database;
    try { d1 = getTenantD1(env, { dbBinding: binding }); } catch { continue; }
    const { results } = await d1
      .prepare(
        `SELECT s.tenant_id AS tenantId, MAX(s.updated_at, COALESCE((SELECT MAX(p.updated_at) FROM products p WHERE p.tenant_id = s.tenant_id AND p.online = 1), '')) AS updatedAt
         FROM store_settings s WHERE s.enabled = 1 AND s.indexable = 1 AND s.location_id IS NOT NULL`,
      )
      .all<{ tenantId: string; updatedAt: string }>();
    for (const r of results) {
      const t = list.find((x) => x.id === r.tenantId);
      if (t) out.push({ slug: t.slug, domain: null, updatedAt: r.updatedAt });
    }
  }
  if (out.length) {
    const ids = tenants.filter((t) => out.some((o) => o.slug === t.slug)).map((t) => t.id);
    const domains: Array<{ tenantId: string; hostname: string }> = [];
    for (const part of chunk(ids, 80)) {
      domains.push(
        ...(await cdb
          .select({ tenantId: control.tenantDomains.tenantId, hostname: control.tenantDomains.hostname })
          .from(control.tenantDomains)
          .where(and(inArray(control.tenantDomains.tenantId, part), eq(control.tenantDomains.status, "active")))),
      );
    }
    for (const d of domains) {
      const slug = tenants.find((t) => t.id === d.tenantId)?.slug;
      const entry = out.find((o) => o.slug === slug);
      if (entry) entry.domain = d.hostname;
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
