import { Hono, type Context } from "hono";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import {
  can,
  fromMilli,
  IMPORT_BATCH_SIZE,
  importProductSchema,
  normalizeSearch,
  productInputSchema,
  stockStatus,
  toMilli,
  type ImportResult,
  type Paginated,
  type ProductDetail,
  type ProductInputParsed,
  type ProductListItem,
  type UnitCode,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { emitFrom } from "../lib/outbound";
import { auditEntry, diff } from "../lib/audit";
import { newId } from "../lib/crypto";
import { assertWithinLimit, remaining } from "../lib/plan";
import { AppError, notFound } from "../lib/errors";
import { isUniqueError, movementStatements, toStatement } from "../lib/inventory";
import {
  createProductStatements,
  defaultLocationId,
  findCodeConflicts,
  generateSku,
  searchTextFor,
  validateQuantities,
  validateReferences,
} from "../lib/products";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { products, variants, stockLevels, taxRates, categories, brands } = tenant;

const listQuery = z.object({
  q: z.string().max(100).optional(),
  categoryId: z.string().max(40).optional(),
  brandId: z.string().max(40).optional(),
  status: z.enum(["active", "archived"]).default("active"),
  stock: z.enum(["all", "low", "out"]).default("all"),
  online: z.enum(["yes", "no"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Per-product aggregates over its live variants and their stock in every location. */
const AGGREGATES = `
WITH st AS (
  SELECT variant_id, SUM(quantity) AS qty FROM stock_levels WHERE tenant_id = ?1 GROUP BY variant_id
), agg AS (
  SELECT v.product_id,
    COUNT(*) AS variant_count,
    MIN(v.price_cents) AS price_min,
    MAX(v.price_cents) AS price_max,
    SUM(COALESCE(st.qty, 0)) AS stock,
    SUM(CASE WHEN COALESCE(st.qty, 0) <= 0 THEN 1 ELSE 0 END) AS out_count,
    SUM(CASE WHEN COALESCE(st.qty, 0) > 0 AND v.min_stock > 0 AND COALESCE(st.qty, 0) <= v.min_stock THEN 1 ELSE 0 END) AS low_count,
    SUM(COALESCE(st.qty, 0) * v.cost_cents) AS value_milli,
    MIN(CASE WHEN v.position = (SELECT MIN(position) FROM variants v2 WHERE v2.product_id = v.product_id AND v2.deleted_at IS NULL) THEN v.sku END) AS sku
  FROM variants v LEFT JOIN st ON st.variant_id = v.id
  WHERE v.tenant_id = ?1 AND v.deleted_at IS NULL
  GROUP BY v.product_id
)`;

type ListRow = {
  id: string; name: string; images: string; unit: string; track_inventory: number; online: number; status: "active" | "archived";
  category: string | null; brand: string | null; variant_count: number; price_min: number; price_max: number;
  stock: number; out_count: number; low_count: number; value_milli: number; sku: string;
};

function productStatus(r: ListRow) {
  if (!r.track_inventory) return "untracked" as const;
  if (r.out_count >= r.variant_count) return "out" as const;
  if (r.out_count > 0 || r.low_count > 0) return "low" as const;
  return "ok" as const;
}

/** Loads a product with live variants and stock by location. */
async function loadProduct(c: { var: AppEnv["Variables"] }, id: string): Promise<ProductDetail | null> {
  const { db, tenant: t, role } = c.var.auth;
  const showCost = can(role, "costs:read");
  const p = await db.select().from(products).where(and(eq(products.id, id), eq(products.tenantId, t.id), isNull(products.deletedAt))).get();
  if (!p) return null;
  const vs = await db.select().from(variants).where(and(eq(variants.productId, id), eq(variants.tenantId, t.id), isNull(variants.deletedAt))).orderBy(asc(variants.position));
  const levels = vs.length
    ? await db.select().from(stockLevels).where(and(eq(stockLevels.tenantId, t.id), inArray(stockLevels.variantId, vs.map((v) => v.id))))
    : [];
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    brandId: p.brandId,
    taxRateId: p.taxRateId,
    unit: p.unit as UnitCode,
    trackInventory: p.trackInventory,
    online: p.online,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    optionNames: p.optionNames,
    images: p.images,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    variants: vs.map((v) => {
      const byLoc = levels.filter((l) => l.variantId === v.id);
      const stock = fromMilli(byLoc.reduce((sum, l) => sum + l.quantity, 0));
      return {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        options: v.options,
        priceCents: v.priceCents,
        costCents: showCost ? v.costCents : null,
        minStock: fromMilli(v.minStock),
        active: v.active,
        stock,
        stockByLocation: byLoc.map((l) => ({ locationId: l.locationId, quantity: fromMilli(l.quantity) })),
        stockStatus: stockStatus(stock, fromMilli(v.minStock), p.trackInventory),
      };
    }),
  };
}

function uniqueToFieldError(err: unknown): never {
  if (isUniqueError(err)) {
    const msg = String((err as Error).message);
    if (msg.includes("barcode")) throw new AppError(409, "duplicate_code", "Un código de barras ya lo usa otro producto");
    throw new AppError(409, "duplicate_code", "Un SKU ya lo usa otro producto");
  }
  throw err;
}

export const productRoutes = new Hono<AppEnv>()
  /* ---------- List with search, filters and pagination ---------- */
  .get("/", requirePermission("catalog:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t, role } = c.var.auth;
    const showCost = can(role, "costs:read");
    const params: unknown[] = [t.id, query.status];
    const where = ["p.tenant_id = ?1", "p.deleted_at IS NULL", "p.status = ?2"];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("?", `?${params.length}`));
    };
    const q = query.q ? normalizeSearch(query.q) : "";
    if (q) add("instr(p.search_text, ?) > 0", q);
    if (query.categoryId) add("p.category_id = ?", query.categoryId);
    if (query.online) add("p.online = ?", query.online === "yes" ? 1 : 0);
    if (query.brandId) add("p.brand_id = ?", query.brandId);
    if (query.stock === "out") where.push("p.track_inventory = 1 AND agg.out_count > 0");
    if (query.stock === "low") where.push("p.track_inventory = 1 AND (agg.out_count > 0 OR agg.low_count > 0)");

    const from = `FROM products p JOIN agg ON agg.product_id = p.id
      LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE ${where.join(" AND ")}`;
    const offset = (query.page - 1) * query.pageSize;
    const [countRes, rowsRes] = await d1.batch([
      d1.prepare(`${AGGREGATES} SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1
        .prepare(
          `${AGGREGATES} SELECT p.id, p.name, p.images, p.unit, p.track_inventory, p.online, p.status, c.name AS category, b.name AS brand,
             agg.variant_count, agg.price_min, agg.price_max, agg.stock, agg.out_count, agg.low_count, agg.value_milli, agg.sku
           ${from} ORDER BY p.name COLLATE NOCASE, p.id LIMIT ${query.pageSize} OFFSET ${offset}`,
        )
        .bind(...params),
    ]);
    const total = (countRes!.results[0] as { total: number } | undefined)?.total ?? 0;
    const items: ProductListItem[] = (rowsRes!.results as ListRow[]).map((r) => {
      const images = JSON.parse(r.images) as string[];
      return {
        id: r.id,
        name: r.name,
        image: images[0] ?? null,
        sku: r.sku,
        category: r.category,
        brand: r.brand,
        unit: r.unit as UnitCode,
        trackInventory: Boolean(r.track_inventory),
        status: r.status,
        online: Boolean(r.online),
        variantCount: r.variant_count,
        priceMin: r.price_min,
        priceMax: r.price_max,
        stock: fromMilli(r.stock),
        stockStatus: productStatus(r),
        inventoryValueCents: showCost ? Math.round(r.value_milli / 1000) : null,
      };
    });
    const body: Paginated<ProductListItem> = { items, total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  /* ---------- Detail ---------- */
  .get("/:id", requirePermission("catalog:read"), async (c) => {
    const product = await loadProduct(c, c.req.param("id"));
    if (!product) throw notFound("Producto");
    return c.json(product);
  })

  /* ---------- Create ---------- */
  .post("/", requirePermission("catalog:write"), json(productInputSchema), async (c) => {
    const input = c.req.valid("json") as ProductInputParsed;
    const { d1 } = c.var.auth;
    validateQuantities(input);
    await assertWithinLimit(c, "products");
    await validateReferences(c, input);
    const conflicts = await findCodeConflicts(c, input.variants);
    if (Object.keys(conflicts).length) throw new AppError(422, "validation_error", "Revisa los campos marcados", conflicts);
    const needsLocation = input.trackInventory && input.variants.some((v) => (v.initialStock ?? 0) > 0);
    const locationId = needsLocation ? await defaultLocationId(c) : null;

    const { productId, statements, skus } = createProductStatements(c, input, { locationId, reason: "initial" });
    statements.push(
      toStatement(d1, auditEntry(c, { action: "product.create", entity: "product", entityId: productId, after: { name: input.name, skus } })),
    );
    try {
      await d1.batch(statements);
    } catch (err) {
      uniqueToFieldError(err);
    }
    const created = await loadProduct(c, productId);
    emitFrom(c, "product.created", created);
    return c.json(created, 201);
  })

  /* ---------- Update (product fields + variants) ---------- */
  .put("/:id", requirePermission("catalog:write"), json(productInputSchema), async (c) => {
    const input = c.req.valid("json") as ProductInputParsed;
    const id = c.req.param("id");
    const { db, d1, tenant: t, user } = c.var.auth;
    const current = await db.select().from(products).where(and(eq(products.id, id), eq(products.tenantId, t.id), isNull(products.deletedAt))).get();
    if (!current) throw notFound("Producto");
    const currentVariants = await db.select().from(variants).where(and(eq(variants.productId, id), isNull(variants.deletedAt)));
    const stockRows = currentVariants.length
      ? await db.select().from(stockLevels).where(and(eq(stockLevels.tenantId, t.id), inArray(stockLevels.variantId, currentVariants.map((v) => v.id))))
      : [];
    const stockOf = (variantId: string) => stockRows.filter((s) => s.variantId === variantId).reduce((sum, s) => sum + s.quantity, 0);
    const totalStock = currentVariants.reduce((sum, v) => sum + stockOf(v.id), 0);

    validateQuantities(input);
    await validateReferences(c, input);
    if (current.unit !== input.unit && totalStock !== 0) {
      throw new AppError(422, "validation_error", "Revisa los campos marcados", { unit: "No puedes cambiar la unidad mientras haya existencias" });
    }
    if (current.trackInventory && !input.trackInventory && totalStock !== 0) {
      throw new AppError(422, "validation_error", "Revisa los campos marcados", { trackInventory: "Deja las existencias en 0 antes de dejar de controlar inventario" });
    }

    const byId = new Map(currentVariants.map((v) => [v.id, v]));
    input.variants.forEach((v, i) => {
      if (v.id && !byId.has(v.id)) throw new AppError(422, "validation_error", "Revisa los campos marcados", { [`variants.${i}`]: "Esta variante ya no existe. Recarga la página." });
    });
    const keptIds = new Set(input.variants.map((v) => v.id).filter(Boolean));
    const removed = currentVariants.filter((v) => !keptIds.has(v.id));
    const blocked = removed.find((v) => stockOf(v.id) !== 0);
    if (blocked) {
      throw new AppError(409, "variant_has_stock", `La variante ${blocked.sku} tiene existencias. Ajústalas a 0 antes de eliminarla.`);
    }

    const finalVariants = input.variants.map((v) => ({ ...v, sku: v.sku || byId.get(v.id ?? "")?.sku || generateSku(input.name) }));
    const conflicts = await findCodeConflicts(c, finalVariants, id);
    if (Object.keys(conflicts).length) throw new AppError(422, "validation_error", "Revisa los campos marcados", conflicts);

    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    // Free the codes of removed variants first so a new variant can reuse them.
    for (const v of removed) {
      statements.push(toStatement(d1, db.update(variants).set({ deletedAt: now }).where(and(eq(variants.id, v.id), eq(variants.tenantId, t.id)))));
    }
    const added: string[] = [];
    const changed: string[] = [];
    const needsLocation = input.trackInventory && finalVariants.some((v) => !v.id && (v.initialStock ?? 0) > 0);
    const locationId = needsLocation ? await defaultLocationId(c) : null;
    finalVariants.forEach((v, position) => {
      const values = {
        sku: v.sku,
        barcode: v.barcode,
        options: v.options,
        priceCents: v.priceCents,
        costCents: v.costCents,
        minStock: toMilli(v.minStock),
        position,
        active: v.active,
      };
      if (v.id) {
        const before = byId.get(v.id)!;
        const d = diff({ ...before, options: before.options } as Record<string, unknown>, values);
        if (d.changed) {
          changed.push(v.sku);
          statements.push(toStatement(d1, db.update(variants).set(values).where(and(eq(variants.id, v.id), eq(variants.tenantId, t.id)))));
        }
      } else {
        const variantId = newId();
        added.push(v.sku);
        statements.push(toStatement(d1, db.insert(variants).values({ ...values, id: variantId, tenantId: t.id, productId: id })));
        if (locationId && v.initialStock && v.initialStock > 0) {
          statements.push(
            ...movementStatements(d1, { tenantId: t.id, userId: user.id, userName: user.name }, {
              kind: "initial", variantId, locationId, quantityMilli: toMilli(v.initialStock), unitCostCents: v.costCents, reason: "initial", reference: id,
            }),
          );
        }
      }
    });

    const productValues = {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      brandId: input.brandId,
      taxRateId: input.taxRateId,
      unit: input.unit,
      trackInventory: input.trackInventory,
      online: input.online,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      optionNames: input.optionNames,
      images: input.images,
    };
    const productDiff = diff(current as Record<string, unknown>, productValues);
    statements.push(
      toStatement(
        d1,
        db
          .update(products)
          .set({ ...productValues, searchText: searchTextFor(input.name, finalVariants), updatedAt: now })
          .where(and(eq(products.id, id), eq(products.tenantId, t.id))),
      ),
    );
    if (productDiff.changed || added.length || changed.length || removed.length) {
      statements.push(
        toStatement(
          d1,
          auditEntry(c, {
            action: "product.update",
            entity: "product",
            entityId: id,
            before: productDiff.before,
            after: {
              ...productDiff.after,
              ...(added.length && { variantsAdded: added }),
              ...(changed.length && { variantsChanged: changed }),
              ...(removed.length && { variantsRemoved: removed.map((v) => v.sku) }),
            },
          }),
        ),
      );
    }
    try {
      await d1.batch(statements);
    } catch (err) {
      uniqueToFieldError(err);
    }
    const updated = await loadProduct(c, id);
    emitFrom(c, "product.updated", updated);
    return c.json(updated);
  })

  /* ---------- Archive / restore / delete ---------- */
  .post("/:id/archive", requirePermission("catalog:write"), (c) => setStatus(c, "archived"))
  .post("/:id/restore", requirePermission("catalog:write"), (c) => setStatus(c, "active"))
  .delete("/:id", requirePermission("catalog:write"), async (c) => {
    const id = c.req.param("id");
    const { db, d1, tenant: t } = c.var.auth;
    const product = await loadProduct(c, id);
    if (!product) throw notFound("Producto");
    if (product.variants.some((v) => v.stock !== 0)) {
      throw new AppError(409, "has_stock", "Este producto tiene existencias. Ajústalas a 0 o archívalo en lugar de eliminarlo.");
    }
    const now = new Date().toISOString();
    // Soft delete: the Kardex keeps pointing to these rows.
    await d1.batch([
      toStatement(d1, db.update(products).set({ deletedAt: now }).where(and(eq(products.id, id), eq(products.tenantId, t.id)))),
      toStatement(d1, db.update(variants).set({ deletedAt: now }).where(and(eq(variants.productId, id), eq(variants.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: "product.delete", entity: "product", entityId: id, before: { name: product.name } })),
    ]);
    emitFrom(c, "product.deleted", { id, name: product.name, skus: product.variants.map((v) => v.sku) });
    return c.body(null, 204);
  })

  /* ---------- CSV import (the dashboard parses the file and sends batches) ---------- */
  .post("/import", requirePermission("catalog:write"), json(z.object({ products: z.array(z.unknown()).min(1).max(IMPORT_BATCH_SIZE) })), async (c) => {
    const { products: raw } = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const result: ImportResult = { created: 0, errors: [], createdTaxes: [] };

    const [cats, brs, taxes] = await Promise.all([
      db.select().from(categories).where(eq(categories.tenantId, t.id)),
      db.select().from(brands).where(eq(brands.tenantId, t.id)),
      db.select().from(taxRates).where(and(eq(taxRates.tenantId, t.id), eq(taxRates.active, true))),
    ]);
    const catByName = new Map(cats.map((x) => [x.name.toLowerCase(), x.id]));
    const brandByName = new Map(brs.map((x) => [x.name.toLowerCase(), x.id]));
    const newNamed: D1PreparedStatement[] = [];
    const resolveNamed = (name: string | null, map: Map<string, string>, table: typeof categories | typeof brands) => {
      if (!name) return null;
      const key = name.toLowerCase();
      let id = map.get(key);
      if (!id) {
        id = newId();
        map.set(key, id);
        newNamed.push(toStatement(d1, db.insert(table).values({ id, tenantId: t.id, name })));
      }
      return id;
    };

    let locationId: string | null = null;
    const ready: Array<{ index: number; input: ProductInputParsed; rows: number[] }> = [];
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();
    for (const [index, item] of raw.entries()) {
      const parsed = importProductSchema.safeParse(item);
      const rows = (item as { rows?: number[] })?.rows ?? [];
      const name = String((item as { name?: unknown })?.name ?? "");
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        result.errors.push({ index, rows, name, message: `${issue.path.join(".")}: ${issue.message}` });
        continue;
      }
      const p = parsed.data;
      let taxRateId: string | null = null;
      if (p.taxPercent !== null) {
        const rateBps = Math.round(p.taxPercent * 100);
        let tax = taxes.find((x) => x.rateBps === rateBps);
        if (!tax) {
          // The file asks for a rate the business has not configured yet: create it (not as default).
          tax = { id: newId(), tenantId: t.id, name: `Impuesto ${p.taxPercent} %`, rateBps, isDefault: false, active: true, createdAt: new Date().toISOString() };
          taxes.push(tax);
          newNamed.push(toStatement(d1, db.insert(taxRates).values(tax)));
          result.createdTaxes.push(tax.name);
        }
        taxRateId = tax.id;
      }
      const input = productInputSchema.safeParse({
        name: p.name, description: p.description, taxRateId, unit: p.unit, trackInventory: p.trackInventory,
        optionNames: p.optionNames, variants: p.variants, categoryId: null, brandId: null, images: [],
      });
      if (!input.success) {
        const issue = input.error.issues[0]!;
        result.errors.push({ index, rows, name, message: `${issue.path.join(".")}: ${issue.message}` });
        continue;
      }
      try {
        validateQuantities(input.data);
      } catch (err) {
        result.errors.push({ index, rows, name, message: Object.values((err as AppError).fields ?? {})[0] ?? (err as Error).message });
        continue;
      }
      const dup = input.data.variants.find((v) => (v.sku && seenSkus.has(v.sku.toLowerCase())) || (v.barcode && seenBarcodes.has(v.barcode)));
      if (dup) {
        result.errors.push({ index, rows, name, message: `SKU o código repetido en el archivo (${dup.sku || dup.barcode})` });
        continue;
      }
      input.data.variants.forEach((v) => { if (v.sku) seenSkus.add(v.sku.toLowerCase()); if (v.barcode) seenBarcodes.add(v.barcode); });
      ready.push({ index, rows, input: { ...input.data, categoryId: resolveNamed(p.categoryName, catByName, categories), brandId: resolveNamed(p.brandName, brandByName, brands) } });
    }

    // SKUs and barcodes already used in the catalog.
    const allVariants = ready.flatMap((r) => r.input.variants.map((v) => ({ sku: v.sku, barcode: v.barcode, owner: r.index })));
    const conflicts = await findCodeConflicts(c, allVariants);
    const badOwners = new Map<number, string>();
    Object.entries(conflicts).forEach(([path, message]) => {
      const owner = allVariants[Number(path.split(".")[1])]!.owner;
      if (!badOwners.has(owner)) badOwners.set(owner, message);
    });

    const statements: D1PreparedStatement[] = [];
    const createdSkus: string[] = [];
    const room = await remaining(c, "products");
    for (const r of ready) {
      if (badOwners.has(r.index)) {
        result.errors.push({ index: r.index, rows: r.rows, name: r.input.name, message: badOwners.get(r.index)! });
        continue;
      }
      if (result.created >= room) {
        result.errors.push({ index: r.index, rows: r.rows, name: r.input.name, message: "Llegaste al límite de productos de tu plan. Mejóralo para importar más." });
        continue;
      }
      if (!locationId && r.input.trackInventory && r.input.variants.some((v) => (v.initialStock ?? 0) > 0)) locationId = await defaultLocationId(c);
      const created = createProductStatements(c, r.input, { locationId, reason: "import" });
      statements.push(...created.statements);
      createdSkus.push(...created.skus);
      result.created++;
    }
    if (result.created === 0) result.createdTaxes = [];
    if (result.created > 0) {
      statements.unshift(...newNamed);
      statements.push(toStatement(d1, auditEntry(c, { action: "product.import", entity: "product", after: { count: result.created, skus: createdSkus.slice(0, 50) } })));
      try {
        await d1.batch(statements);
      } catch (err) {
        // Extremely unlikely (codes taken between the check and the write): report the whole batch.
        if (!isUniqueError(err)) throw err;
        return c.json({ created: 0, createdTaxes: [], errors: ready.map((r) => ({ index: r.index, rows: r.rows, name: r.input.name, message: "SKU o código ya usado. Vuelve a intentarlo." })) } satisfies ImportResult);
      }
    }
    result.errors.sort((a, b) => a.index - b.index);
    return c.json(result);
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setStatus(c: Context<AppEnv, any>, status: "active" | "archived") {
  const id = c.req.param("id") as string;
  const { db, d1, tenant: t } = c.var.auth;
  const p = await db.select({ status: products.status, name: products.name }).from(products).where(and(eq(products.id, id), eq(products.tenantId, t.id), isNull(products.deletedAt))).get();
  if (!p) throw notFound("Producto");
  if (p.status !== status) {
    await d1.batch([
      toStatement(d1, db.update(products).set({ status, updatedAt: new Date().toISOString() }).where(and(eq(products.id, id), eq(products.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: status === "archived" ? "product.archive" : "product.restore", entity: "product", entityId: id, after: { name: p.name } })),
    ]);
    emitFrom(c, "product.updated", await loadProduct(c, id));
  }
  return c.json({ id, status });
}

