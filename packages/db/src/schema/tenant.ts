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
  /** Highest discount a cashier can give, in basis points of the subtotal (1000 = 10 %). */
  cashierMaxDiscountBps: integer("cashier_max_discount_bps").notNull().default(1000),
  receiptWidthMm: integer("receipt_width_mm").notNull().default(80),
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
    /** Shown in the online store (when the product is also active). */
    online: integer("online", { mode: "boolean" }).notNull().default(false),
    /** Search engines (Phase 7): null → the product name / description. */
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
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
    type: text("type", { enum: ["initial", "in", "out", "adjust", "sale", "return", "purchase", "transfer_out", "transfer_in", "order", "order_cancel"] }).notNull(),
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

/* ======================= Phase 2 — Point of sale ======================= */

/** Gapless per-business sequences (sale folios). Incremented inside the same batch as the sale. */
export const counters = sqliteTable(
  "counters",
  {
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.name] })],
);

/** A cash drawer shift: opened with a float, closed with a blind count. One open session per location. */
export const cashSessions = sqliteTable(
  "cash_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    locationId: text("location_id").notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    openingCashCents: integer("opening_cash_cents").notNull(),
    openedBy: text("opened_by"),
    openedByName: text("opened_by_name"),
    openedAt: text("opened_at").notNull().default(now),
    closedBy: text("closed_by"),
    closedByName: text("closed_by_name"),
    closedAt: text("closed_at"),
    expectedCashCents: integer("expected_cash_cents"),
    countedCashCents: integer("counted_cash_cents"),
    differenceCents: integer("difference_cents"),
    /** Snapshot of the totals at closing time. */
    totals: text("totals", { mode: "json" }),
    note: text("note"),
  },
  (t) => [
    index("cash_sessions_tenant_idx").on(t.tenantId, t.openedAt),
    uniqueIndex("cash_sessions_one_open_uq").on(t.tenantId, t.locationId).where(sql`status = 'open'`),
  ],
);

export const cashMovements = sqliteTable(
  "cash_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id").notNull(),
    type: text("type", { enum: ["in", "out"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("cash_movements_session_idx").on(t.sessionId)],
);

export const sales = sqliteTable(
  "sales",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    /** Gapless folio per business. */
    number: integer("number").notNull(),
    /** Idempotency key sent by the POS. */
    clientId: text("client_id").notNull(),
    locationId: text("location_id").notNull(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    customerName: text("customer_name"),
    customerContact: text("customer_contact"),
    /** Customer record (Phase 5); name/contact above stay as the snapshot printed on the receipt. */
    customerId: text("customer_id"),
    couponCode: text("coupon_code"),
    /** Part of discount_cents that came from automatic promotions and the coupon (not given by hand). */
    promoDiscountCents: integer("promo_discount_cents").notNull().default(0),
    note: text("note"),
    status: text("status", { enum: ["completed", "voided"] }).notNull().default("completed"),
    pricesIncludeTax: integer("prices_include_tax", { mode: "boolean" }).notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    costCents: integer("cost_cents").notNull(),
    paidCents: integer("paid_cents").notNull(),
    changeCents: integer("change_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    /** Local date in the business time zone, used by reports and summaries. */
    businessDate: text("business_date").notNull(),
    createdAt: text("created_at").notNull().default(now),
    voidedAt: text("voided_at"),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("sales_tenant_number_uq").on(t.tenantId, t.number),
    uniqueIndex("sales_tenant_client_uq").on(t.tenantId, t.clientId),
    index("sales_tenant_date_idx").on(t.tenantId, t.businessDate),
    index("sales_session_idx").on(t.sessionId),
    index("sales_customer_idx").on(t.tenantId, t.customerId),
  ],
);

/** Snapshot of what was sold: later product changes never alter past sales. */
export const saleItems = sqliteTable(
  "sale_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    saleId: text("sale_id").notNull(),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    sku: text("sku").notNull(),
    unit: text("unit").notNull(),
    trackInventory: integer("track_inventory", { mode: "boolean" }).notNull(),
    /** Thousandths of the unit. */
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    /** Line discount + its share of the cart discount. */
    discountCents: integer("discount_cents").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),
    netCents: integer("net_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    promotionId: text("promotion_id"),
    returnedQuantity: integer("returned_quantity").notNull().default(0),
    position: integer("position").notNull(),
  },
  (t) => [index("sale_items_sale_idx").on(t.saleId), check("sale_items_returned_le_qty", sql`${t.returnedQuantity} <= ${t.quantity}`)],
);

export const salePayments = sqliteTable(
  "sale_payments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    saleId: text("sale_id").notNull(),
    method: text("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reference: text("reference"),
  },
  (t) => [index("sale_payments_sale_idx").on(t.saleId)],
);

export const saleReturns = sqliteTable(
  "sale_returns",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    saleId: text("sale_id").notNull(),
    locationId: text("location_id").notNull(),
    /** Cash session that paid a cash refund (null for other methods). */
    sessionId: text("session_id"),
    refundMethod: text("refund_method").notNull(),
    refundCents: integer("refund_cents").notNull(),
    restock: integer("restock", { mode: "boolean" }).notNull(),
    reason: text("reason").notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    businessDate: text("business_date").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("sale_returns_sale_idx").on(t.saleId), index("sale_returns_session_idx").on(t.sessionId)],
);

export const saleReturnItems = sqliteTable(
  "sale_return_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    returnId: text("return_id").notNull(),
    saleItemId: text("sale_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    refundCents: integer("refund_cents").notNull(),
  },
  (t) => [index("sale_return_items_return_idx").on(t.returnId)],
);

/** Per-day totals, updated in the same batch as each sale, void or return. Reports read these. */
export const dailySales = sqliteTable(
  "daily_sales",
  {
    tenantId: text("tenant_id").notNull(),
    date: text("date").notNull(),
    locationId: text("location_id").notNull(),
    salesCount: integer("sales_count").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    returnsCents: integer("returns_cents").notNull().default(0),
    voidedCount: integer("voided_count").notNull().default(0),
    /** Part of sales_count / total_cents that came from completed online orders. */
    onlineCount: integer("online_count").notNull().default(0),
    onlineTotalCents: integer("online_total_cents").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.date, t.locationId] })],
);

export const dailyProductSales = sqliteTable(
  "daily_product_sales",
  {
    tenantId: text("tenant_id").notNull(),
    date: text("date").notNull(),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    /** Net of returns, thousandths. */
    quantity: integer("quantity").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.date, t.variantId] }), index("daily_product_tenant_date_idx").on(t.tenantId, t.date)],
);


/* ======================================================================
 * Phase 3: suppliers, purchase orders, transfers and physical counts.
 * Status changes run as `SET status = CASE WHEN status IN (...) THEN 'next' END`
 * inside the same batch as their stock movements: if another request changed the
 * status first, the CASE yields NULL, the NOT NULL constraint fails and the whole
 * batch (stock included) rolls back.
 * ==================================================================== */

export const suppliers = sqliteTable(
  "suppliers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    taxId: text("tax_id"),
    address: text("address"),
    /** Credit days the supplier gives (0 = cash on delivery). */
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    notes: text("notes"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("suppliers_tenant_name_uq").on(t.tenantId, t.name)],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    /** Gapless folio per business (counter "purchase"). Orders are cancelled, never deleted. */
    number: integer("number").notNull(),
    supplierId: text("supplier_id").notNull(),
    /** Where the goods arrive. */
    locationId: text("location_id").notNull(),
    status: text("status", { enum: ["draft", "ordered", "partial", "received", "cancelled"] }).notNull().default("draft"),
    expectedDate: text("expected_date"),
    note: text("note"),
    /** Net (before tax) and tax of the ordered lines, recomputed on every edit. */
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /** Net value received so far, at the cost actually received. */
    receivedCents: integer("received_cents").notNull().default(0),
    createdBy: text("created_by"),
    createdByName: text("created_by_name"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    orderedAt: text("ordered_at"),
    closedAt: text("closed_at"),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("purchase_orders_tenant_number_uq").on(t.tenantId, t.number),
    index("purchase_orders_tenant_status_idx").on(t.tenantId, t.status),
    index("purchase_orders_supplier_idx").on(t.tenantId, t.supplierId),
  ],
);

export const purchaseOrderItems = sqliteTable(
  "purchase_order_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    orderId: text("order_id").notNull(),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    sku: text("sku").notNull(),
    unit: text("unit").notNull(),
    /** Thousandths of the unit. */
    quantity: integer("quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    /** Net unit cost agreed with the supplier (before tax). */
    unitCostCents: integer("unit_cost_cents").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    position: integer("position").notNull(),
  },
  (t) => [
    index("purchase_order_items_order_idx").on(t.orderId),
    // Two concurrent receipts can never receive more than was ordered.
    check("purchase_order_items_received_le_qty", sql`${t.receivedQuantity} <= ${t.quantity}`),
  ],
);

export const purchaseReceipts = sqliteTable(
  "purchase_receipts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    orderId: text("order_id").notNull(),
    locationId: text("location_id").notNull(),
    /** Supplier invoice or delivery note number. */
    supplierReference: text("supplier_reference"),
    note: text("note"),
    /** Net value received. */
    totalCents: integer("total_cents").notNull(),
    /** Accounts payable (Phase 5): tax of the receipt, what is owed (net + tax), paid so far and due date. */
    taxCents: integer("tax_cents").notNull().default(0),
    amountDueCents: integer("amount_due_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    dueDate: text("due_date"),
    userId: text("user_id"),
    userName: text("user_name"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("purchase_receipts_order_idx").on(t.orderId)],
);

export const purchaseReceiptItems = sqliteTable(
  "purchase_receipt_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    receiptId: text("receipt_id").notNull(),
    orderItemId: text("order_item_id").notNull(),
    variantId: text("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
  },
  (t) => [index("purchase_receipt_items_receipt_idx").on(t.receiptId)],
);

export const transfers = sqliteTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    number: integer("number").notNull(),
    fromLocationId: text("from_location_id").notNull(),
    toLocationId: text("to_location_id").notNull(),
    status: text("status", { enum: ["draft", "in_transit", "received", "cancelled"] }).notNull().default("draft"),
    note: text("note"),
    createdBy: text("created_by"),
    createdByName: text("created_by_name"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    sentAt: text("sent_at"),
    sentByName: text("sent_by_name"),
    receivedAt: text("received_at"),
    receivedByName: text("received_by_name"),
    cancelledAt: text("cancelled_at"),
    cancelledByName: text("cancelled_by_name"),
  },
  (t) => [uniqueIndex("transfers_tenant_number_uq").on(t.tenantId, t.number), index("transfers_tenant_status_idx").on(t.tenantId, t.status)],
);

export const transferItems = sqliteTable(
  "transfer_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    transferId: text("transfer_id").notNull(),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    sku: text("sku").notNull(),
    unit: text("unit").notNull(),
    quantity: integer("quantity").notNull(),
    /** Set when received; may be lower than what was sent (lost or damaged in transit). */
    receivedQuantity: integer("received_quantity"),
    /** Average cost when it was sent, to value differences. */
    unitCostCents: integer("unit_cost_cents"),
    position: integer("position").notNull(),
  },
  (t) => [index("transfer_items_transfer_idx").on(t.transferId), check("transfer_items_received_le_qty", sql`${t.receivedQuantity} IS NULL OR ${t.receivedQuantity} <= ${t.quantity}`)],
);

export const stockCounts = sqliteTable(
  "stock_counts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    number: integer("number").notNull(),
    locationId: text("location_id").notNull(),
    status: text("status", { enum: ["in_progress", "completed", "cancelled"] }).notNull().default("in_progress"),
    /** What it covers: every tracked product, one category, or products added by hand. */
    scope: text("scope", { enum: ["all", "category", "manual"] }).notNull(),
    categoryId: text("category_id"),
    note: text("note"),
    createdBy: text("created_by"),
    createdByName: text("created_by_name"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    completedAt: text("completed_at"),
    completedByName: text("completed_by_name"),
    /** Snapshot of the result: counted lines, adjusted lines, units and value of the differences. */
    summary: text("summary", { mode: "json" }),
  },
  (t) => [uniqueIndex("stock_counts_tenant_number_uq").on(t.tenantId, t.number), index("stock_counts_tenant_status_idx").on(t.tenantId, t.status)],
);

export const stockCountItems = sqliteTable(
  "stock_count_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    countId: text("count_id").notNull(),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    unit: text("unit").notNull(),
    /** System stock when the line was added to the count. */
    expectedQuantity: integer("expected_quantity").notNull(),
    /** null = not counted yet. */
    countedQuantity: integer("counted_quantity"),
    countedByName: text("counted_by_name"),
    countedAt: text("counted_at"),
    /**
     * System stock at the moment the line was counted. On completion the stock moves by
     * (counted − stockAtCount), so sales or receipts made after counting are not lost.
     */
    stockAtCount: integer("stock_at_count"),
    /** Filled when the count is completed: stock right before the adjustment and the applied difference. */
    finalBefore: integer("final_before"),
    finalDelta: integer("final_delta"),
    unitCostCents: integer("unit_cost_cents"),
  },
  (t) => [uniqueIndex("stock_count_items_count_variant_uq").on(t.countId, t.variantId), index("stock_count_items_count_idx").on(t.countId)],
);


/* ======================================================================
 * Phase 4: online store.
 * An order reserves stock when it is placed (Kardex type "order", same CHECK as a sale, so the
 * web and the POS can never sell the same last unit). Cancelling returns it ("order_cancel").
 * Completing it (delivered and paid) adds it to the daily summaries like a sale.
 * ==================================================================== */

export const storeSettings = sqliteTable("store_settings", {
  tenantId: text("tenant_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  /** Location whose stock the store sells and that prepares the orders. */
  locationId: text("location_id"),
  tagline: text("tagline"),
  about: text("about"),
  pickupEnabled: integer("pickup_enabled", { mode: "boolean" }).notNull().default(true),
  pickupInstructions: text("pickup_instructions"),
  deliveryEnabled: integer("delivery_enabled", { mode: "boolean" }).notNull().default(false),
  deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
  /** Free delivery from this order total (null = never free). */
  freeDeliveryFromCents: integer("free_delivery_from_cents"),
  deliveryArea: text("delivery_area"),
  minOrderCents: integer("min_order_cents").notNull().default(0),
  /** Pay on pickup / on delivery (cash or card at the door). */
  payOnDelivery: integer("pay_on_delivery", { mode: "boolean" }).notNull().default(true),
  transferEnabled: integer("transfer_enabled", { mode: "boolean" }).notNull().default(false),
  /** Card payments online through the business's Stripe account (needs the plan and a connected account). */
  cardEnabled: integer("card_enabled", { mode: "boolean" }).notNull().default(false),
  transferInstructions: text("transfer_instructions"),
  whatsapp: text("whatsapp"),
  /** Who gets the "new order" email. null → the business email. */
  notifyEmail: text("notify_email"),
  /** Unconfirmed, unpaid orders are cancelled after this many hours and their stock released. 0 = never. */
  holdHours: integer("hold_hours").notNull().default(48),
  /* ---------- Phase 7: search engines and AI answers ---------- */
  /** <title> of the store front (default: the business name + tagline). */
  seoTitle: text("seo_title"),
  /** Meta description of the store front (default: tagline / about). */
  seoDescription: text("seo_description"),
  /** false → noindex and left out of the sitemaps. */
  indexable: integer("indexable", { mode: "boolean" }).notNull().default(true),
  /** Frequently asked questions, shown in the store and marked up as FAQPage. */
  faq: text("faq", { mode: "json" }).$type<Array<{ q: string; a: string }>>().notNull().default(sql`'[]'`),
  updatedAt: text("updated_at").notNull().default(now),
});

/**
 * The store's legal pages (privacy notice, terms, returns). Each save that changes the text is a new
 * version kept in store_policy_versions, so an order can prove exactly which text the customer accepted.
 */
export const storePolicies = sqliteTable(
  "store_policies",
  {
    tenantId: text("tenant_id").notNull(),
    kind: text("kind", { enum: ["privacy", "terms", "returns"] }).notNull(),
    /** Markdown subset: headings, paragraphs, lists, bold, links. */
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    published: integer("published", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.kind] })],
);

export const storePolicyVersions = sqliteTable(
  "store_policy_versions",
  {
    tenantId: text("tenant_id").notNull(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.kind, t.version] })],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    /** Gapless folio per business (counter "order"). */
    number: integer("number").notNull(),
    /** Secret in the customer's tracking link. */
    token: text("token").notNull(),
    /** Idempotency key generated by the store for each checkout. */
    clientId: text("client_id").notNull(),
    locationId: text("location_id").notNull(),
    status: text("status", { enum: ["pending", "confirmed", "ready", "completed", "cancelled"] }).notNull().default("pending"),
    fulfillment: text("fulfillment", { enum: ["pickup", "delivery"] }).notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerId: text("customer_id"),
    couponCode: text("coupon_code"),
    /** Promotions + coupon. */
    discountCents: integer("discount_cents").notNull().default(0),
    address: text("address"),
    notes: text("notes"),
    /** What the customer chose: pay on pickup/delivery, bank transfer or card online (Stripe). */
    paymentMethod: text("payment_method", { enum: ["on_delivery", "transfer", "card"] }).notNull(),
    /** Stripe Checkout session of a card order. */
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    paymentStatus: text("payment_status", { enum: ["pending", "paid"] }).notNull().default("pending"),
    /** How it was actually paid (cash, card, transfer…), set when the payment is recorded. */
    paidMethod: text("paid_method"),
    paidReference: text("paid_reference"),
    paidAt: text("paid_at"),
    /** Cash session that received a cash payment. */
    sessionId: text("session_id"),
    pricesIncludeTax: integer("prices_include_tax", { mode: "boolean" }).notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    costCents: integer("cost_cents").notNull(),
    ip: text("ip"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    confirmedAt: text("confirmed_at"),
    readyAt: text("ready_at"),
    completedAt: text("completed_at"),
    completedByName: text("completed_by_name"),
    /** Business date of the completion (daily summaries). */
    businessDate: text("business_date"),
    cancelledAt: text("cancelled_at"),
    cancelReason: text("cancel_reason"),
    cancelledBy: text("cancelled_by", { enum: ["customer", "staff", "system"] }),
    /** The customer accepted the store's terms and privacy notice (versions at that moment). */
    legalAcceptedAt: text("legal_accepted_at"),
    termsVersion: integer("terms_version"),
    privacyVersion: integer("privacy_version"),
  },
  (t) => [
    uniqueIndex("orders_tenant_number_uq").on(t.tenantId, t.number),
    uniqueIndex("orders_tenant_client_uq").on(t.tenantId, t.clientId),
    uniqueIndex("orders_token_uq").on(t.token),
    index("orders_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    index("orders_customer_idx").on(t.tenantId, t.customerId),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    orderId: text("order_id").notNull(),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    sku: text("sku").notNull(),
    unit: text("unit").notNull(),
    image: text("image"),
    trackInventory: integer("track_inventory", { mode: "boolean" }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    promotionId: text("promotion_id"),
    netCents: integer("net_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);


/* ======================================================================
 * Phase 5: customers, promotions, coupons and accounts payable.
 * ==================================================================== */

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    /** Lowercase. */
    email: text("email"),
    /** Digits only, to match however it was typed. */
    phone: text("phone"),
    taxId: text("tax_id"),
    address: text("address"),
    notes: text("notes"),
    acceptsMarketing: integer("accepts_marketing", { mode: "boolean" }).notNull().default(false),
    /** Where it was created: dashboard, POS or the online store. */
    source: text("source", { enum: ["admin", "pos", "online"] }).notNull().default("admin"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    searchText: text("search_text").notNull().default(""),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    index("customers_tenant_name_idx").on(t.tenantId, t.name),
    index("customers_tenant_email_idx").on(t.tenantId, t.email),
    index("customers_tenant_phone_idx").on(t.tenantId, t.phone),
  ],
);

/** Automatic percentage discount on everything, some categories or some products, for a date range. */
export const promotions = sqliteTable(
  "promotions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    percentBps: integer("percent_bps").notNull(),
    target: text("target", { enum: ["all", "category", "product"] }).notNull(),
    targetIds: text("target_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    channel: text("channel", { enum: ["all", "pos", "online"] }).notNull().default("all"),
    /** Inclusive local dates (business time zone). null = no limit. */
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("promotions_tenant_idx").on(t.tenantId, t.active)],
);

export const coupons = sqliteTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    /** Uppercase. */
    code: text("code").notNull(),
    description: text("description"),
    kind: text("kind", { enum: ["percent", "amount"] }).notNull(),
    /** Basis points for percent, cents for amount. */
    value: integer("value").notNull(),
    minSubtotalCents: integer("min_subtotal_cents").notNull().default(0),
    maxUses: integer("max_uses"),
    usesCount: integer("uses_count").notNull().default(0),
    channel: text("channel", { enum: ["all", "pos", "online"] }).notNull().default("all"),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("coupons_tenant_code_uq").on(t.tenantId, t.code),
    // Two checkouts using the last available redemption at once: one batch fails.
    check("coupons_uses_le_max", sql`${t.maxUses} IS NULL OR ${t.usesCount} <= ${t.maxUses}`),
  ],
);

/** A payment to a supplier against one receipt (invoice). */
export const supplierPayments = sqliteTable(
  "supplier_payments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    supplierId: text("supplier_id").notNull(),
    receiptId: text("receipt_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    paidOn: text("paid_on").notNull(),
    note: text("note"),
    /** Cash session it was taken from, when paid from the drawer. */
    sessionId: text("session_id"),
    userId: text("user_id"),
    userName: text("user_name"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("supplier_payments_receipt_idx").on(t.receiptId), index("supplier_payments_supplier_idx").on(t.tenantId, t.supplierId)],
);
