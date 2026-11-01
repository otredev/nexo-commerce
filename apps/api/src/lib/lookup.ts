import { fromMilli, normalizeSearch, type LookupVariant, type UnitCode } from "@nexo/shared";

export interface LookupOptions {
  locationId: string;
  q?: string;
  /** Exact list of variants (any order). */
  variantIds?: string[];
  categoryId?: string | null;
  /** Only variants at or under their minimum stock in the location. */
  lowOnly?: boolean;
  limit?: number;
  showCost: boolean;
}

/**
 * Tracked, active variants with their stock at one location, average cost and effective tax.
 * Used by the product pickers of purchases, transfers and counts, and by reorder suggestions.
 */
export async function lookupVariants(d1: D1Database, tenantId: string, o: LookupOptions): Promise<LookupVariant[]> {
  const params: unknown[] = [tenantId, o.locationId];
  const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
  const where = ["v.tenant_id = ?1", "v.deleted_at IS NULL", "p.deleted_at IS NULL", "p.status = 'active'", "p.track_inventory = 1"];
  let exact = "0";
  const raw = o.q?.trim() ?? "";
  if (raw) {
    const code = add(raw);
    const upper = add(raw.toUpperCase());
    exact = `(v.barcode = ${code} OR v.sku = ${upper})`;
    where.push(`(${exact} OR instr(p.search_text, ${add(normalizeSearch(raw))}) > 0)`);
  }
  if (o.variantIds) {
    if (!o.variantIds.length) return [];
    where.push(`v.id IN (${o.variantIds.map((id) => add(id)).join(", ")})`);
  }
  if (o.categoryId) where.push(`p.category_id = ${add(o.categoryId)}`);
  if (o.lowOnly) where.push("v.min_stock > 0 AND COALESCE(sl.quantity, 0) <= v.min_stock");
  const limit = o.variantIds ? o.variantIds.length : (o.limit ?? 30);
  const { results } = await d1
    .prepare(
      `SELECT v.id AS variant_id, p.id AS product_id, p.name, v.options, v.sku, v.barcode, p.unit, p.images, v.cost_cents, v.min_stock,
         COALESCE(tr.rate_bps, (SELECT rate_bps FROM tax_rates WHERE tenant_id = ?1 AND is_default = 1 LIMIT 1), 0) AS rate_bps,
         COALESCE(sl.quantity, 0) AS qty, ${exact} AS exact
       FROM variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
       LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.location_id = ?2
       WHERE ${where.join(" AND ")}
       ORDER BY exact DESC, p.name COLLATE NOCASE, v.position
       LIMIT ${limit}`,
    )
    .bind(...params)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    variantId: r.variant_id as string,
    productId: r.product_id as string,
    name: r.name as string,
    options: JSON.parse(r.options as string) as string[],
    sku: r.sku as string,
    barcode: r.barcode as string | null,
    unit: r.unit as UnitCode,
    image: (JSON.parse(r.images as string) as string[])[0] ?? null,
    costCents: o.showCost ? (r.cost_cents as number) : null,
    taxRateBps: r.rate_bps as number,
    stock: fromMilli(r.qty as number),
    minStock: fromMilli(r.min_stock as number),
    exact: Boolean(r.exact),
  }));
}
