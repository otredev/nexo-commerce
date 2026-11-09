import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Context } from "hono";
import { tenant } from "@nexo/db";
import { normalizeSearch, quantityFitsUnit, toMilli, unitInfo, type ProductInputParsed } from "@nexo/shared";
import type { AppEnv } from "../env";
import { newId } from "./crypto";
import { AppError } from "./errors";
import { chunk, movementStatements, toStatement } from "./inventory";

const { products, variants, taxRates, categories, brands, locations } = tenant;

export function searchTextFor(name: string, vs: Array<{ sku: string; barcode: string | null; options?: string[] }>, keywords: readonly string[] = []) {
  const parts = [name, ...keywords, ...vs.flatMap((v) => [v.sku, v.barcode ?? "", ...(v.options ?? [])])];
  return normalizeSearch(parts.filter(Boolean).join(" "));
}

/** "Camisa de lino" → "CAM-7KQ2P". Unique index on (tenant, sku) guards the rare collision. */
export function generateSku(name: string): string {
  const prefix = normalizeSearch(name).replace(/[^a-z0-9]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const rand = crypto.getRandomValues(new Uint8Array(5));
  return `${prefix}-${[...rand].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/** Field errors use the same paths as the form: "variants.2.sku". */
function fieldError(path: string, message: string): never {
  throw new AppError(422, "validation_error", "Revisa los campos marcados", { [path]: message });
}

export async function defaultLocationId(c: Context<AppEnv>): Promise<string> {
  const { db, tenant: t } = c.var.auth;
  const loc = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, t.id), eq(locations.isDefault, true))).get();
  if (!loc) throw new AppError(409, "no_default_location", "Configura una ubicación principal antes de cargar inventario.");
  return loc.id;
}

/** Checks that referenced category, brand and tax belong to this business. */
export async function validateReferences(c: Context<AppEnv>, input: Pick<ProductInputParsed, "categoryId" | "brandId" | "taxRateId">) {
  const { db, tenant: t } = c.var.auth;
  const [cat, brand, tax] = await Promise.all([
    input.categoryId ? db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.tenantId, t.id))).get() : null,
    input.brandId ? db.select({ id: brands.id }).from(brands).where(and(eq(brands.id, input.brandId), eq(brands.tenantId, t.id))).get() : null,
    input.taxRateId ? db.select({ id: taxRates.id }).from(taxRates).where(and(eq(taxRates.id, input.taxRateId), eq(taxRates.tenantId, t.id))).get() : null,
  ]);
  if (input.categoryId && !cat) fieldError("categoryId", "La categoría no existe");
  if (input.brandId && !brand) fieldError("brandId", "La marca no existe");
  if (input.taxRateId && !tax) fieldError("taxRateId", "El impuesto no existe");
}

/** Quantities must be whole numbers unless the unit allows decimals (kg, l, m). */
export function validateQuantities(input: ProductInputParsed) {
  const unit = unitInfo(input.unit);
  input.variants.forEach((v, i) => {
    if (!quantityFitsUnit(v.minStock, input.unit)) fieldError(`variants.${i}.minStock`, unit.decimals ? "Máximo 3 decimales" : `Usa números enteros (${unit.label.toLowerCase()})`);
    if (v.initialStock !== undefined && !quantityFitsUnit(v.initialStock, input.unit)) fieldError(`variants.${i}.initialStock`, unit.decimals ? "Máximo 3 decimales" : `Usa números enteros (${unit.label.toLowerCase()})`);
  });
}

/**
 * Finds SKUs or barcodes already used by OTHER products of this business.
 * Returns field errors keyed by the variant index.
 */
export async function findCodeConflicts(c: Context<AppEnv>, vs: Array<{ sku: string; barcode: string | null }>, excludeProductId?: string) {
  const { db, tenant: t } = c.var.auth;
  const skus = vs.map((v) => v.sku).filter(Boolean);
  const barcodes = vs.map((v) => v.barcode).filter((b): b is string => Boolean(b));
  const taken = { skus: new Set<string>(), barcodes: new Set<string>() };
  const base = [eq(variants.tenantId, t.id), isNull(variants.deletedAt), ...(excludeProductId ? [ne(variants.productId, excludeProductId)] : [])];
  for (const part of chunk(skus)) {
    const rows = await db.select({ sku: variants.sku }).from(variants).where(and(...base, inArray(variants.sku, part)));
    rows.forEach((r) => taken.skus.add(r.sku.toLowerCase()));
  }
  for (const part of chunk(barcodes)) {
    const rows = await db.select({ barcode: variants.barcode }).from(variants).where(and(...base, inArray(variants.barcode, part)));
    rows.forEach((r) => r.barcode && taken.barcodes.add(r.barcode));
  }
  const errors: Record<string, string> = {};
  vs.forEach((v, i) => {
    if (v.sku && taken.skus.has(v.sku.toLowerCase())) errors[`variants.${i}.sku`] = "Este SKU ya lo usa otro producto";
    if (v.barcode && taken.barcodes.has(v.barcode)) errors[`variants.${i}.barcode`] = "Este código ya lo usa otro producto";
  });
  return errors;
}

/**
 * Statements that create a product, its variants, their initial stock (Kardex "initial") and the audit entry.
 * The caller runs them in one d1.batch().
 */
export function createProductStatements(
  c: Context<AppEnv>,
  input: ProductInputParsed,
  opts: { locationId: string | null; reason: "initial" | "import" },
): { productId: string; statements: D1PreparedStatement[]; skus: string[] } {
  const { db, d1, tenant: t, user } = c.var.auth;
  const productId = newId();
  const vs = input.variants.map((v) => ({ ...v, id: newId(), sku: v.sku || generateSku(input.name) }));
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    toStatement(
      d1,
      db.insert(products).values({
        id: productId,
        tenantId: t.id,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        brandId: input.brandId,
        taxRateId: input.taxRateId,
        unit: input.unit,
        trackInventory: input.trackInventory,
        online: input.online ?? false,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        optionNames: input.optionNames,
        images: input.images,
        keywords: input.keywords,
        searchText: searchTextFor(input.name, vs, input.keywords),
        createdAt: now,
        updatedAt: now,
      }),
    ),
  ];
  vs.forEach((v, position) => {
    statements.push(
      toStatement(
        d1,
        db.insert(variants).values({
          id: v.id,
          tenantId: t.id,
          productId,
          sku: v.sku,
          barcode: v.barcode,
          options: v.options,
          priceCents: v.priceCents,
          costCents: v.costCents,
          minStock: toMilli(v.minStock),
          position,
          active: v.active,
        }),
      ),
    );
  });
  if (input.trackInventory && opts.locationId) {
    for (const v of vs) {
      if (v.initialStock && v.initialStock > 0) {
        statements.push(
          ...movementStatements(d1, { tenantId: t.id, userId: user.id, userName: user.name }, {
            kind: "initial",
            variantId: v.id,
            locationId: opts.locationId,
            quantityMilli: toMilli(v.initialStock),
            unitCostCents: v.costCents,
            reason: opts.reason,
            reference: productId,
          }),
        );
      }
    }
  }
  return { productId, statements, skus: vs.map((v) => v.sku) };
}
