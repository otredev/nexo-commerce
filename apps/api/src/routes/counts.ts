import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import {
  can,
  completeCountSchema,
  countAddItemsSchema,
  countEntriesSchema,
  COUNT_STATUSES,
  createCountSchema,
  docNumber,
  fromMilli,
  quantityFitsUnit,
  toMilli,
  unitInfo,
  type CountStatus,
  type Paginated,
  type StockCountDetail,
  type StockCountListItem,
  type StockCountSummary,
  type UnitCode,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { chunk, countAdjustmentStatements, isTransitionError, toStatement, transitionStatement } from "../lib/inventory";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { stockCounts, stockCountItems, locations, categories } = tenant;

const changed = () => new AppError(409, "status_changed", "El conteo ya se aplicó o se canceló. Recarga para ver su estado.");

interface SummaryMilli { lines: number; counted: number; adjusted: number; overMilli: number; shortMilli: number; valueMilliCents: number }

const toSummary = (s: SummaryMilli | null, showCost: boolean): StockCountSummary | null =>
  s
    ? {
        lines: s.lines,
        counted: s.counted,
        adjusted: s.adjusted,
        unitsOver: fromMilli(s.overMilli ?? 0),
        unitsShort: fromMilli(Math.abs(s.shortMilli ?? 0)),
        valueDeltaCents: showCost ? Math.round((s.valueMilliCents ?? 0) / 1000) : null,
      }
    : null;

/** Variants a count covers when it starts: every tracked product, or one category. */
const SNAPSHOT_FROM = `
  FROM variants v JOIN products p ON p.id = v.product_id
  LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.location_id = ?3
  WHERE v.tenant_id = ?2 AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'active' AND p.track_inventory = 1`;
const SNAPSHOT_INSERT = `
  INSERT INTO stock_count_items (id, tenant_id, count_id, variant_id, product_id, name, options, sku, barcode, unit, expected_quantity)
  SELECT lower(hex(randomblob(13))), ?2, ?1, v.id, p.id, p.name, v.options, v.sku, v.barcode, p.unit, COALESCE(sl.quantity, 0)`;

async function loadCount(c: Context<AppEnv>, id: string): Promise<StockCountDetail | null> {
  const { db, tenant: t, role } = c.var.auth;
  const row = await db.select().from(stockCounts).where(and(eq(stockCounts.id, id), eq(stockCounts.tenantId, t.id))).get();
  if (!row) return null;
  const [location, category, items] = await Promise.all([
    db.select({ name: locations.name }).from(locations).where(eq(locations.id, row.locationId)).get(),
    row.categoryId ? db.select({ name: categories.name }).from(categories).where(eq(categories.id, row.categoryId)).get() : Promise.resolve(undefined),
    db.select().from(stockCountItems).where(eq(stockCountItems.countId, id)),
  ]);
  const showExpected = can(role, "counts:write");
  const showCost = can(role, "costs:read");
  items.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }) || a.sku.localeCompare(b.sku));
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    locationId: row.locationId,
    locationName: location?.name ?? "—",
    scope: row.scope,
    categoryName: category?.name ?? null,
    lines: items.length,
    counted: items.filter((i) => i.countedQuantity !== null).length,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
    completedAt: row.completedAt,
    completedByName: row.completedByName,
    note: row.note,
    summary: toSummary(row.summary as SummaryMilli | null, showCost),
    showExpected,
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productId: i.productId,
      name: i.name,
      options: i.options,
      sku: i.sku,
      barcode: i.barcode,
      unit: i.unit as UnitCode,
      expectedQuantity: showExpected ? fromMilli(i.stockAtCount ?? i.expectedQuantity) : null,
      countedQuantity: i.countedQuantity === null ? null : fromMilli(i.countedQuantity),
      countedByName: i.countedByName,
      finalDelta: showExpected && i.finalDelta !== null ? fromMilli(i.finalDelta) : null,
      unitCostCents: showCost ? i.unitCostCents : null,
    })),
  };
}

async function getCount(c: Context<AppEnv>, id: string) {
  const { db, tenant: t } = c.var.auth;
  const row = await db.select().from(stockCounts).where(and(eq(stockCounts.id, id), eq(stockCounts.tenantId, t.id))).get();
  if (!row) throw notFound("Conteo");
  return row;
}

/** Keeps a count "in progress" inside a batch, so edits fail if it was completed or cancelled meanwhile. */
const stillOpen = (d1: D1Database, id: string, tenantId: string) =>
  transitionStatement(d1, "stock_counts", { id, tenantId }, ["in_progress"], "in_progress", { updated_at: new Date().toISOString() });

const listQuery = z.object({
  status: z.enum(["all", ...COUNT_STATUSES]).default("all"),
  locationId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const countRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("counts:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t, role } = c.var.auth;
    const params: unknown[] = [t.id];
    const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
    const where = ["sc.tenant_id = ?1"];
    if (query.status !== "all") where.push(`sc.status = ${add(query.status)}`);
    if (query.locationId) where.push(`sc.location_id = ${add(query.locationId)}`);
    const from = `FROM stock_counts sc WHERE ${where.join(" AND ")}`;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1
        .prepare(
          `SELECT sc.*, l.name AS location_name, cat.name AS category_name,
             (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = sc.id) AS lines,
             (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = sc.id AND i.counted_quantity IS NOT NULL) AS counted
           FROM stock_counts sc LEFT JOIN locations l ON l.id = sc.location_id LEFT JOIN categories cat ON cat.id = sc.category_id
           WHERE ${where.join(" AND ")} ORDER BY sc.number DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        )
        .bind(...params),
    ]);
    const showCost = can(role, "costs:read");
    const items: StockCountListItem[] = (rows!.results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      number: r.number as number,
      status: r.status as CountStatus,
      locationId: r.location_id as string,
      locationName: (r.location_name as string | null) ?? "—",
      scope: r.scope as StockCountListItem["scope"],
      categoryName: r.category_name as string | null,
      lines: r.lines as number,
      counted: r.counted as number,
      createdAt: r.created_at as string,
      createdByName: r.created_by_name as string | null,
      completedAt: r.completed_at as string | null,
      summary: can(role, "counts:write") ? toSummary(r.summary ? (JSON.parse(r.summary as string) as SummaryMilli) : null, showCost) : null,
    }));
    const body: Paginated<StockCountListItem> = { items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  .get("/:id", requirePermission("counts:read"), async (c) => {
    const count = await loadCount(c, c.req.param("id"));
    if (!count) throw notFound("Conteo");
    return c.json(count);
  })

  /** Starts a count and snapshots the expected stock of every line in one statement. */
  .post("/", requirePermission("counts:write"), json(createCountSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    const location = await db.select({ active: locations.active }).from(locations).where(and(eq(locations.id, input.locationId), eq(locations.tenantId, t.id))).get();
    if (!location?.active) throw new AppError(422, "validation_error", "Revisa los campos marcados", { locationId: "Elige una ubicación activa" });
    if (input.scope === "category") {
      const cat = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, input.categoryId!), eq(categories.tenantId, t.id))).get();
      if (!cat) throw new AppError(422, "validation_error", "Revisa los campos marcados", { categoryId: "Elige una categoría" });
    }
    const id = newId();
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      d1.prepare("INSERT INTO counters (tenant_id, name, value) VALUES (?1, 'count', 1) ON CONFLICT(tenant_id, name) DO UPDATE SET value = value + 1").bind(t.id),
      d1
        .prepare(
          `INSERT INTO stock_counts (id, tenant_id, number, location_id, status, scope, category_id, note, created_by, created_by_name, created_at, updated_at)
           SELECT ?1, ?2, value, ?3, 'in_progress', ?4, ?5, ?6, ?7, ?8, ?9, ?9 FROM counters WHERE tenant_id = ?2 AND name = 'count'`,
        )
        .bind(id, t.id, input.locationId, input.scope, input.scope === "category" ? input.categoryId : null, input.note, user.id, user.name, now),
    ];
    if (input.scope === "all") statements.push(d1.prepare(`${SNAPSHOT_INSERT} ${SNAPSHOT_FROM}`).bind(id, t.id, input.locationId));
    if (input.scope === "category") statements.push(d1.prepare(`${SNAPSHOT_INSERT} ${SNAPSHOT_FROM} AND p.category_id = ?4`).bind(id, t.id, input.locationId, input.categoryId));
    statements.push(toStatement(d1, auditEntry(c, { action: "count.create", entity: "stock_count", entityId: id, after: { locationId: input.locationId, scope: input.scope } })));
    await d1.batch(statements);
    return c.json(await loadCount(c, id), 201);
  })

  /** Adds products found during the count (or every line of a manual count). Existing lines are kept. */
  .post("/:id/items", requirePermission("counts:count"), json(countAddItemsSchema), async (c) => {
    const { variantIds } = c.req.valid("json");
    const { d1, tenant: t } = c.var.auth;
    const row = await getCount(c, c.req.param("id"));
    if (row.status !== "in_progress") throw changed();
    const statements: D1PreparedStatement[] = [stillOpen(d1, row.id, t.id)];
    for (const part of chunk([...new Set(variantIds)], 90)) {
      const list = part.map((_, i) => `?${i + 4}`).join(", ");
      statements.push(d1.prepare(`${SNAPSHOT_INSERT} ${SNAPSHOT_FROM} AND v.id IN (${list}) ON CONFLICT(count_id, variant_id) DO NOTHING`).bind(row.id, t.id, row.locationId, ...part));
    }
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadCount(c, row.id));
  })

  /**
   * Saves counted quantities (absolute values; null clears a line). Records the system stock at
   * that moment so the final adjustment respects later sales and receipts.
   */
  .post("/:id/entries", requirePermission("counts:count"), json(countEntriesSchema), async (c) => {
    const { entries } = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    const row = await getCount(c, c.req.param("id"));
    if (row.status !== "in_progress") throw changed();
    const items = await db.select({ id: stockCountItems.id, unit: stockCountItems.unit, name: stockCountItems.name }).from(stockCountItems).where(eq(stockCountItems.countId, row.id));
    const byId = new Map(items.map((i) => [i.id, i]));
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [stillOpen(d1, row.id, t.id)];
    entries.forEach((e, n) => {
      const item = byId.get(e.itemId);
      if (!item) throw new AppError(422, "validation_error", "Una línea no pertenece a este conteo.", { [`entries.${n}`]: "No válida" });
      if (e.countedQuantity === null) {
        statements.push(
          d1.prepare("UPDATE stock_count_items SET counted_quantity = NULL, stock_at_count = NULL, counted_by_name = NULL, counted_at = NULL WHERE id = ?1 AND tenant_id = ?2").bind(e.itemId, t.id),
        );
        return;
      }
      if (!quantityFitsUnit(e.countedQuantity, item.unit)) {
        throw new AppError(422, "validation_error", `${item.name}: ${unitInfo(item.unit).decimals ? "máximo 3 decimales" : "usa cantidades enteras"}`, { [`entries.${n}.countedQuantity`]: "Cantidad no válida" });
      }
      statements.push(
        d1
          .prepare(
            `UPDATE stock_count_items SET counted_quantity = ?1, counted_by_name = ?2, counted_at = ?3,
               stock_at_count = COALESCE((SELECT quantity FROM stock_levels sl WHERE sl.variant_id = stock_count_items.variant_id AND sl.location_id = ?4), 0)
             WHERE id = ?5 AND tenant_id = ?6`,
          )
          .bind(toMilli(e.countedQuantity), user.name, now, row.locationId, e.itemId, t.id),
      );
    });
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadCount(c, row.id));
  })

  /** Applies the count: stock adjustments, Kardex entries, summary and status in one batch. */
  .post("/:id/complete", requirePermission("counts:write"), json(completeCountSchema), async (c) => {
    const { zeroUncounted } = c.req.valid("json");
    const { d1, tenant: t, user } = c.var.auth;
    const row = await getCount(c, c.req.param("id"));
    if (row.status !== "in_progress") throw changed();
    const counted = await d1.prepare("SELECT COUNT(*) AS n FROM stock_count_items WHERE count_id = ?1 AND counted_quantity IS NOT NULL").bind(row.id).first<{ n: number }>();
    if (!zeroUncounted && !counted?.n) throw new AppError(422, "nothing_counted", "Aún no se ha contado ningún producto.");
    const now = new Date().toISOString();
    const actor = { tenantId: t.id, userId: user.id, userName: user.name };
    const statements: D1PreparedStatement[] = [
      transitionStatement(d1, "stock_counts", { id: row.id, tenantId: t.id }, ["in_progress"], "completed", { completed_at: now, completed_by_name: user.name, updated_at: now }),
    ];
    if (zeroUncounted) {
      statements.push(
        d1
          .prepare(
            `UPDATE stock_count_items SET counted_quantity = 0, counted_by_name = ?3, counted_at = ?4,
               stock_at_count = COALESCE((SELECT quantity FROM stock_levels sl WHERE sl.variant_id = stock_count_items.variant_id AND sl.location_id = ?5), 0)
             WHERE count_id = ?1 AND tenant_id = ?2 AND counted_quantity IS NULL`,
          )
          .bind(row.id, t.id, user.name, now, row.locationId),
      );
    }
    statements.push(
      ...countAdjustmentStatements(d1, actor, row.id, row.locationId, docNumber("count", row.number)),
      d1
        .prepare(
          `UPDATE stock_counts SET summary = (
             SELECT json_object(
               'lines', COUNT(*),
               'counted', SUM(counted_quantity IS NOT NULL),
               'adjusted', SUM(COALESCE(final_delta, 0) <> 0),
               'overMilli', SUM(MAX(COALESCE(final_delta, 0), 0)),
               'shortMilli', SUM(MIN(COALESCE(final_delta, 0), 0)),
               'valueMilliCents', SUM(COALESCE(final_delta, 0) * COALESCE(unit_cost_cents, 0)))
             FROM stock_count_items WHERE count_id = ?1)
           WHERE id = ?1 AND tenant_id = ?2`,
        )
        .bind(row.id, t.id),
      toStatement(d1, auditEntry(c, { action: "count.complete", entity: "stock_count", entityId: row.id, after: { number: row.number, zeroUncounted } })),
    );
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadCount(c, row.id));
  })

  .post("/:id/cancel", requirePermission("counts:write"), async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const row = await getCount(c, c.req.param("id"));
    if (row.status !== "in_progress") throw changed();
    try {
      await d1.batch([
        transitionStatement(d1, "stock_counts", { id: row.id, tenantId: t.id }, ["in_progress"], "cancelled", { updated_at: new Date().toISOString() }),
        toStatement(d1, auditEntry(c, { action: "count.cancel", entity: "stock_count", entityId: row.id, after: { number: row.number } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadCount(c, row.id));
  });
