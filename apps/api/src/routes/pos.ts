import { Hono } from "hono";
import { z } from "zod";
import { fromMilli, normalizeSearch, type PosProduct, type UnitCode } from "@nexo/shared";
import type { AppEnv } from "../env";
import { requirePermission } from "../middleware/auth";

const query = z.object({
  locationId: z.string().min(1).max(40),
  q: z.string().max(100).optional(),
  categoryId: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});

/** Sellable variants for the POS: active, with price, effective tax and stock in the POS location. */
export const posRoutes = new Hono<AppEnv>().get("/products", requirePermission("pos:sell"), async (c) => {
  const input = query.parse(c.req.query());
  const { d1, tenant: t } = c.var.auth;
  const params: unknown[] = [t.id, input.locationId];
  const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
  const where = ["v.tenant_id = ?1", "v.deleted_at IS NULL", "v.active = 1", "p.deleted_at IS NULL", "p.status = 'active'"];
  let exact = "0";
  const raw = input.q?.trim() ?? "";
  if (raw) {
    const code = add(raw);
    const upper = add(raw.toUpperCase());
    exact = `(v.barcode = ${code} OR v.sku = ${upper})`;
    where.push(`(${exact} OR instr(p.search_text, ${add(normalizeSearch(raw))}) > 0)`);
  }
  if (input.categoryId) where.push(`p.category_id = ${add(input.categoryId)}`);
  const { results } = await d1
    .prepare(
      `SELECT v.id AS variant_id, p.id AS product_id, p.name, v.options, v.sku, v.barcode, p.unit, p.images, v.price_cents, p.track_inventory,
         COALESCE(tr.rate_bps, (SELECT rate_bps FROM tax_rates WHERE tenant_id = ?1 AND is_default = 1 LIMIT 1), 0) AS rate_bps,
         sl.quantity AS qty, ${exact} AS exact
       FROM variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id
       LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.location_id = ?2
       WHERE ${where.join(" AND ")}
       ORDER BY exact DESC, p.name COLLATE NOCASE, v.position
       LIMIT ${input.limit}`,
    )
    .bind(...params)
    .all<Record<string, unknown>>();
  const items: PosProduct[] = results.map((r) => ({
    variantId: r.variant_id as string,
    productId: r.product_id as string,
    name: r.name as string,
    options: JSON.parse(r.options as string) as string[],
    sku: r.sku as string,
    barcode: r.barcode as string | null,
    unit: r.unit as UnitCode,
    image: (JSON.parse(r.images as string) as string[])[0] ?? null,
    priceCents: r.price_cents as number,
    taxRateBps: r.rate_bps as number,
    trackInventory: Boolean(r.track_inventory),
    stock: r.track_inventory ? fromMilli((r.qty as number | null) ?? 0) : null,
    exact: Boolean(r.exact),
  }));
  return c.json(items);
});
