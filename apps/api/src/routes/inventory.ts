import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import {
  can,
  formatQty,
  MOVEMENT_TYPES,
  fromMilli,
  normalizeSearch,
  quantityFitsUnit,
  stockMovementSchema,
  stockStatus,
  toMilli,
  unitInfo,
  type InventoryRow,
  type InventorySummary,
  type MovementType,
  type Paginated,
  type StockMovement,
  type UnitCode,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { AppError, notFound } from "../lib/errors";
import { isStockCheckError, movementStatements } from "../lib/inventory";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { variants, products, locations, stockLevels } = tenant;

const listQuery = z.object({
  locationId: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  categoryId: z.string().max(40).optional(),
  stock: z.enum(["all", "low", "out"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const movementsQuery = z.object({
  variantId: z.string().max(40).optional(),
  productId: z.string().max(40).optional(),
  locationId: z.string().max(40).optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

type InvRow = {
  variant_id: string; product_id: string; product_name: string; options: string; sku: string; barcode: string | null;
  unit: string; images: string; qty: number; min_stock: number; cost_cents: number;
};

export const inventoryRoutes = new Hono<AppEnv>()
  /* ---------- Stock per variant (one location or all) ---------- */
  .get("/", requirePermission("inventory:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t, role } = c.var.auth;
    const showCost = can(role, "costs:read");
    const params: unknown[] = [t.id];
    const add = (value: unknown) => { params.push(value); return `?${params.length}`; };
    const stockFilter = query.locationId ? `AND location_id = ${add(query.locationId)}` : "";
    const where = ["v.tenant_id = ?1", "v.deleted_at IS NULL", "p.deleted_at IS NULL", "p.status = 'active'", "p.track_inventory = 1"];
    if (query.q) where.push(`instr(p.search_text, ${add(normalizeSearch(query.q))}) > 0`);
    if (query.categoryId) where.push(`p.category_id = ${add(query.categoryId)}`);
    if (query.stock === "out") where.push("COALESCE(st.qty, 0) <= 0");
    if (query.stock === "low") where.push("(COALESCE(st.qty, 0) <= 0 OR (v.min_stock > 0 AND COALESCE(st.qty, 0) <= v.min_stock))");
    const from = `FROM variants v JOIN products p ON p.id = v.product_id
      LEFT JOIN (SELECT variant_id, SUM(quantity) AS qty FROM stock_levels WHERE tenant_id = ?1 ${stockFilter} GROUP BY variant_id) st ON st.variant_id = v.id
      WHERE ${where.join(" AND ")}`;
    const offset = (query.page - 1) * query.pageSize;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1
        .prepare(
          `SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name, v.options, v.sku, v.barcode, p.unit, p.images,
             COALESCE(st.qty, 0) AS qty, v.min_stock, v.cost_cents
           ${from} ORDER BY p.name COLLATE NOCASE, v.position LIMIT ${query.pageSize} OFFSET ${offset}`,
        )
        .bind(...params),
    ]);
    const items: InventoryRow[] = (rows!.results as InvRow[]).map((r) => {
      const quantity = fromMilli(r.qty);
      return {
        variantId: r.variant_id,
        productId: r.product_id,
        productName: r.product_name,
        options: JSON.parse(r.options) as string[],
        sku: r.sku,
        barcode: r.barcode,
        unit: r.unit as UnitCode,
        image: (JSON.parse(r.images) as string[])[0] ?? null,
        quantity,
        minStock: fromMilli(r.min_stock),
        costCents: showCost ? r.cost_cents : null,
        valueCents: showCost ? Math.round((r.qty * r.cost_cents) / 1000) : null,
        stockStatus: stockStatus(quantity, fromMilli(r.min_stock)),
      };
    });
    const body: Paginated<InventoryRow> = { items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  /* ---------- Dashboard numbers ---------- */
  .get("/summary", requirePermission("inventory:read"), async (c) => {
    const { d1, tenant: t, role } = c.var.auth;
    const row = await d1
      .prepare(
        `WITH st AS (SELECT variant_id, SUM(quantity) AS qty FROM stock_levels WHERE tenant_id = ?1 GROUP BY variant_id)
         SELECT
           (SELECT COUNT(*) FROM products WHERE tenant_id = ?1 AND deleted_at IS NULL AND status = 'active') AS products,
           COUNT(*) AS variants,
           SUM(CASE WHEN p.track_inventory = 1 AND COALESCE(st.qty, 0) > 0 AND v.min_stock > 0 AND st.qty <= v.min_stock THEN 1 ELSE 0 END) AS low,
           SUM(CASE WHEN p.track_inventory = 1 AND COALESCE(st.qty, 0) <= 0 THEN 1 ELSE 0 END) AS out_of_stock,
           SUM(CASE WHEN p.track_inventory = 1 THEN COALESCE(st.qty, 0) * v.cost_cents ELSE 0 END) AS value_milli
         FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN st ON st.variant_id = v.id
         WHERE v.tenant_id = ?1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'active'`,
      )
      .bind(t.id)
      .first<{ products: number; variants: number; low: number | null; out_of_stock: number | null; value_milli: number | null }>();
    const body: InventorySummary = {
      products: row?.products ?? 0,
      variants: row?.variants ?? 0,
      lowStock: row?.low ?? 0,
      outOfStock: row?.out_of_stock ?? 0,
      inventoryValueCents: can(role, "costs:read") ? Math.round((row?.value_milli ?? 0) / 1000) : null,
    };
    return c.json(body);
  })

  /* ---------- Manual movement: entry, exit or physical count ---------- */
  .post("/movements", requirePermission("inventory:write"), json(stockMovementSchema), async (c) => {
    const m = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    const target = await db
      .select({ unit: products.unit, track: products.trackInventory, productName: products.name, sku: variants.sku })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(eq(variants.id, m.variantId), eq(variants.tenantId, t.id), isNull(variants.deletedAt), isNull(products.deletedAt)))
      .get();
    if (!target) throw notFound("Producto");
    if (!target.track) throw new AppError(409, "untracked", "Este producto no controla inventario");
    const location = await db.select({ active: locations.active }).from(locations).where(and(eq(locations.id, m.locationId), eq(locations.tenantId, t.id))).get();
    if (!location) throw notFound("Ubicación");
    if (!location.active) throw new AppError(409, "inactive_location", "La ubicación está desactivada");
    if (!quantityFitsUnit(m.quantity, target.unit)) {
      throw new AppError(422, "validation_error", "Revisa los campos marcados", { quantity: unitInfo(target.unit).decimals ? "Máximo 3 decimales" : "Usa números enteros" });
    }
    const reasonOk = (m.type === "in" && ["purchase", "customer_return", "found", "other_in"].includes(m.reason)) ||
      (m.type === "out" && ["damage", "expired", "loss", "internal_use", "supplier_return", "other_out"].includes(m.reason)) ||
      (m.type === "set" && m.reason === "count");
    if (!reasonOk) throw new AppError(422, "validation_error", "Revisa los campos marcados", { reason: "Elige un motivo válido" });

    const actor = { tenantId: t.id, userId: user.id, userName: user.name };
    const base = { variantId: m.variantId, locationId: m.locationId, reason: m.reason, note: m.note };
    const statements =
      m.type === "in"
        ? movementStatements(d1, actor, { ...base, kind: "in", quantityMilli: toMilli(m.quantity), unitCostCents: m.unitCostCents })
        : m.type === "out"
          ? movementStatements(d1, actor, { ...base, kind: "out", quantityMilli: toMilli(m.quantity) })
          : movementStatements(d1, actor, { ...base, kind: "adjust", targetMilli: toMilli(m.quantity) });
    try {
      await d1.batch(statements);
    } catch (err) {
      if (!isStockCheckError(err)) throw err;
      const level = await db.select({ q: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.variantId, m.variantId), eq(stockLevels.locationId, m.locationId))).get();
      const available = fromMilli(level?.q ?? 0);
      throw new AppError(409, "insufficient_stock", `No hay suficiente stock de ${target.sku}: hay ${formatQty(available, target.unit)} en esta ubicación.`, {
        quantity: `Disponible: ${formatQty(available, target.unit)}`,
      });
    }
    const level = await db.select({ q: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.variantId, m.variantId), eq(stockLevels.locationId, m.locationId))).get();
    return c.json({ variantId: m.variantId, locationId: m.locationId, quantity: fromMilli(level?.q ?? 0) }, 201);
  })

  /* ---------- Kardex ---------- */
  .get("/movements", requirePermission("inventory:read"), async (c) => {
    const query = movementsQuery.parse(c.req.query());
    const { d1, tenant: t, role } = c.var.auth;
    const showCost = can(role, "costs:read");
    const params: unknown[] = [t.id];
    const add = (value: unknown) => { params.push(value); return `?${params.length}`; };
    const where = ["m.tenant_id = ?1"];
    if (query.variantId) where.push(`m.variant_id = ${add(query.variantId)}`);
    if (query.productId) where.push(`v.product_id = ${add(query.productId)}`);
    if (query.locationId) where.push(`m.location_id = ${add(query.locationId)}`);
    if (query.type) where.push(`m.type = ${add(query.type)}`);
    if (query.cursor) where.push(`m.rowid < ${add(query.cursor)}`);
    const { results } = await d1
      .prepare(
        `SELECT m.rowid AS seq, m.id, m.created_at, m.type, m.reason, m.variant_id, v.product_id, p.name AS product_name, v.options, v.sku, p.unit,
           m.location_id, l.name AS location_name, m.quantity_delta, m.balance_after, m.unit_cost_cents, m.note, m.user_name
         FROM stock_movements m
         JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
         LEFT JOIN locations l ON l.id = m.location_id
         WHERE ${where.join(" AND ")}
         ORDER BY m.rowid DESC LIMIT ${query.limit + 1}`,
      )
      .bind(...params)
      .all<Record<string, unknown>>();
    const hasMore = results.length > query.limit;
    const page = results.slice(0, query.limit);
    const items: StockMovement[] = page.map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      type: r.type as MovementType,
      reason: r.reason as string,
      variantId: r.variant_id as string,
      productId: r.product_id as string,
      productName: r.product_name as string,
      options: JSON.parse(r.options as string) as string[],
      sku: r.sku as string,
      unit: r.unit as UnitCode,
      locationId: r.location_id as string,
      locationName: (r.location_name as string | null) ?? "—",
      quantity: fromMilli(r.quantity_delta as number),
      balanceAfter: fromMilli(r.balance_after as number),
      unitCostCents: showCost ? (r.unit_cost_cents as number | null) : null,
      note: r.note as string | null,
      userName: r.user_name as string | null,
    }));
    return c.json({ items, nextCursor: hasMore ? String(page[page.length - 1]!.seq) : null });
  });
