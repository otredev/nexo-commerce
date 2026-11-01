/**
 * BUSINESS database (binding DB_TENANT_DEFAULT, later one D1 per business).
 * Every table carries tenant_id and every query must filter by it.
 * Phase 1 adds products, variants and stock movements here.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
