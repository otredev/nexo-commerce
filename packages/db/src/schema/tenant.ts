/**
 * BUSINESS database (binding DB_TENANT_DEFAULT, later one D1 per business).
 * Every table carries tenant_id and every query must filter by it.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const businessSettings = sqliteTable("business_settings", {
  tenantId: text("tenant_id").primaryKey(),
  tradeName: text("trade_name").notNull(),
  legalName: text("legal_name"),
  taxId: text("tax_id"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  currency: text("currency").notNull().default("MXN"),
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  locale: text("locale").notNull().default("es-MX"),
  pricesIncludeTax: integer("prices_include_tax", { mode: "boolean" }).notNull().default(true),
  receiptFooter: text("receipt_footer"),
  logoKey: text("logo_key"),
  updatedAt: text("updated_at").notNull().default(now),
});

export const taxRates = sqliteTable(
  "tax_rates",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    /** Basis points: 1600 = 16 %. */
    rateBps: integer("rate_bps").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("tax_rates_tenant_idx").on(t.tenantId)],
);

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["store", "warehouse"] }).notNull().default("store"),
    address: text("address"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("locations_tenant_idx").on(t.tenantId), uniqueIndex("locations_tenant_name_uq").on(t.tenantId, t.name)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id"),
    /** Denormalized so the log stays readable even if the user is removed. */
    userName: text("user_name"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: text("before", { mode: "json" }),
    after: text("after", { mode: "json" }),
    ip: text("ip"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("audit_tenant_created_idx").on(t.tenantId, t.createdAt), index("audit_entity_idx").on(t.tenantId, t.entity, t.entityId)],
);

/* ======================= Phase 1 — Catalog and inventory ======================= */

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("categories_tenant_name_uq").on(t.tenantId, t.name)],
);

export const brands = sqliteTable(
  "brands",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("brands_tenant_name_uq").on(t.tenantId, t.name)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: text("category_id"),
    brandId: text("brand_id"),
    /** null → the business's default tax at the time of sale. */
    taxRateId: text("tax_rate_id"),
    unit: text("unit").notNull().default("unit"),
    trackInventory: integer("track_inventory", { mode: "boolean" }).notNull().default(true),
    /** Option names in order, e.g. ["Talla","Color"]. */
    optionNames: text("option_names", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** R2 keys, first one is the main image. */
    images: text("images", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    /** Normalized name + SKUs + barcodes, maintained on every write, for accent-insensitive search. */
    searchText: text("search_text").notNull().default(""),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    /** Soft delete: products with sales history are never removed. */
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("products_tenant_status_idx").on(t.tenantId, t.status, t.name),
    index("products_category_idx").on(t.tenantId, t.categoryId),
    index("products_brand_idx").on(t.tenantId, t.brandId),
  ],
);

export const variants = sqliteTable(
  "variants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    /** Values matching products.option_names, e.g. ["M","Negro"]. */
    options: text("options", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    priceCents: integer("price_cents").notNull(),
    /** Weighted average cost, updated by entries with a unit cost. */
    costCents: integer("cost_cents").notNull().default(0),
    /** Thousandths of the product unit. */
    minStock: integer("min_stock").notNull().default(0),
    position: integer("position").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("variants_product_idx").on(t.productId),
    uniqueIndex("variants_tenant_sku_uq").on(t.tenantId, t.sku).where(sql`deleted_at IS NULL`),
    uniqueIndex("variants_tenant_barcode_uq").on(t.tenantId, t.barcode).where(sql`deleted_at IS NULL AND barcode IS NOT NULL`),
  ],
);

/**
 * Current stock per variant and location. NEVER edited directly by the app:
 * only lib/inventory.ts changes it, always together with its Kardex movement in one batch.
 * The CHECK makes any movement that would leave negative stock fail and roll back its whole batch.
 */
export const stockLevels = sqliteTable(
  "stock_levels",
  {
    tenantId: text("tenant_id").notNull(),
    variantId: text("variant_id").notNull(),
    locationId: text("location_id").notNull(),
    /** Thousandths of the product unit. */
    quantity: integer("quantity").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.locationId] }),
    index("stock_tenant_location_idx").on(t.tenantId, t.locationId),
    check("stock_non_negative", sql`${t.quantity} >= 0`),
  ],
);

/**
 * Kardex: append-only history of every stock change.
 * Ordered by SQLite's implicit rowid, which follows commit order (ids are generated in the Worker
 * and two concurrent requests could create them out of order).
 */
export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    variantId: text("variant_id").notNull(),
    locationId: text("location_id").notNull(),
    type: text("type", { enum: ["initial", "in", "out", "adjust"] }).notNull(),
    reason: text("reason").notNull(),
    /** Signed, thousandths of the unit. */
    quantityDelta: integer("quantity_delta").notNull(),
    /** Stock of this variant in this location right after the movement. */
    balanceAfter: integer("balance_after").notNull(),
    /** Entry cost, or the average cost at the time for outputs (snapshot). */
    unitCostCents: integer("unit_cost_cents"),
    note: text("note"),
    /** Document that caused it (sale, purchase, import...), for later phases. */
    reference: text("reference"),
    userId: text("user_id"),
    userName: text("user_name"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("movements_variant_idx").on(t.tenantId, t.variantId, t.id),
    index("movements_tenant_idx").on(t.tenantId, t.id),
    index("movements_location_idx").on(t.tenantId, t.locationId, t.id),
  ],
);
