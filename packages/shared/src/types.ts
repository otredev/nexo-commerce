import type { Role } from "./roles";
import type { MovementType, StockStatus, UnitCode } from "./catalog";
import type { CountStatus, PurchaseStatus, TransferStatus } from "./purchasing";
import type { CouponRule, PromotionRule } from "./promotions";

/** Shapes returned by the API. Shared by the dashboard so both sides stay in sync. */

export interface MeResponse {
  /** Set when support opened this session from /admin ("Entrar como negocio"). */
  support?: import("./platform").SupportSessionInfo | null;
  /** Support tickets of the business answered by support and not read yet (nav badge). */
  supportWaiting?: number;
  user: { id: string; name: string; email: string };
  tenant: {
    id: string; slug: string; name: string;
    status?: "provisioning" | "active" | "suspended" | "migrating";
    plan?: import("./plans").PlanId;
    suspendedReason?: string | null;
  };
  role: Role;
}

export interface BusinessSettings {
  tradeName: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  locale: string;
  pricesIncludeTax: boolean;
  receiptFooter: string | null;
  logoKey: string | null;
  cashierMaxDiscountBps: number;
  receiptWidthMm: 58 | 80;
  updatedAt: string;
}

export interface TaxRate {
  id: string;
  name: string;
  rateBps: number;
  isDefault: boolean;
  active: boolean;
}

export interface Location {
  id: string;
  name: string;
  type: "store" | "warehouse";
  address: string | null;
  isDefault: boolean;
  active: boolean;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}

/* ---------------- Catalog (Phase 1) ---------------- */

export interface Named {
  id: string;
  name: string;
  productCount: number;
}

/** Row of the products list. Cost fields are null for roles without "costs:read". */
export interface ProductListItem {
  id: string;
  name: string;
  image: string | null;
  sku: string;
  category: string | null;
  brand: string | null;
  unit: UnitCode;
  trackInventory: boolean;
  status: "active" | "archived";
  online: boolean;
  variantCount: number;
  priceMin: number;
  priceMax: number;
  stock: number;
  stockStatus: StockStatus;
  inventoryValueCents: number | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VariantStock {
  locationId: string;
  quantity: number;
}

export interface VariantDetail {
  id: string;
  sku: string;
  barcode: string | null;
  options: string[];
  priceCents: number;
  costCents: number | null;
  minStock: number;
  active: boolean;
  stock: number;
  stockByLocation: VariantStock[];
  stockStatus: StockStatus;
}

export interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  taxRateId: string | null;
  unit: UnitCode;
  trackInventory: boolean;
  online: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  optionNames: string[];
  images: string[];
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  variants: VariantDetail[];
}

export interface InventoryRow {
  variantId: string;
  productId: string;
  productName: string;
  options: string[];
  sku: string;
  barcode: string | null;
  unit: UnitCode;
  image: string | null;
  quantity: number;
  minStock: number;
  costCents: number | null;
  valueCents: number | null;
  stockStatus: StockStatus;
}

export interface StockMovement {
  id: string;
  createdAt: string;
  type: MovementType;
  reason: string;
  variantId: string;
  productId: string;
  productName: string;
  options: string[];
  sku: string;
  unit: UnitCode;
  locationId: string;
  locationName: string;
  quantity: number;
  balanceAfter: number;
  unitCostCents: number | null;
  note: string | null;
  userName: string | null;
}

export interface InventorySummary {
  products: number;
  variants: number;
  lowStock: number;
  outOfStock: number;
  inventoryValueCents: number | null;
}

export interface ImportResult {
  created: number;
  /** Tax rates the file used that did not exist and were created. */
  createdTaxes: string[];
  errors: Array<{ index: number; rows: number[]; name: string; message: string }>;
}

/* ---------------- Point of sale (Phase 2) ---------------- */

export interface PosProduct {
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  barcode: string | null;
  unit: UnitCode;
  image: string | null;
  priceCents: number;
  taxRateBps: number;
  trackInventory: boolean;
  categoryId: string | null;
  /** Stock in the POS location. null when not tracked. */
  stock: number | null;
  /** True when the search matched this SKU or barcode exactly (scanner). */
  exact: boolean;
}

export interface SaleItem {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  unit: UnitCode;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  returnedQuantity: number;
}

export interface SalePayment {
  method: string;
  amountCents: number;
  reference: string | null;
}

export interface SaleReturnSummary {
  id: string;
  createdAt: string;
  userName: string | null;
  refundMethod: string;
  refundCents: number;
  restock: boolean;
  reason: string;
  items: Array<{ saleItemId: string; quantity: number; refundCents: number }>;
}

export interface SaleDetail {
  id: string;
  number: number;
  status: "completed" | "voided";
  createdAt: string;
  businessDate: string;
  locationId: string;
  locationName: string;
  sessionId: string;
  userName: string | null;
  customerName: string | null;
  customerContact: string | null;
  customerId: string | null;
  couponCode: string | null;
  /** Part of discountCents from promotions and the coupon. */
  promoDiscountCents: number;
  note: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  pricesIncludeTax: boolean;
  items: SaleItem[];
  payments: SalePayment[];
  returns: SaleReturnSummary[];
  refundedCents: number;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  /** Can still be voided: completed, no returns, and its cash session is open. */
  voidable: boolean;
}

export interface SaleListItem {
  id: string;
  number: number;
  status: "completed" | "voided";
  createdAt: string;
  userName: string | null;
  customerName: string | null;
  locationName: string;
  itemCount: number;
  totalCents: number;
  refundedCents: number;
  methods: string[];
}

export interface CashSessionTotals {
  openingCashCents: number;
  salesCount: number;
  salesTotalCents: number;
  byMethod: Record<string, number>;
  cashSalesCents: number;
  cashInCents: number;
  cashOutCents: number;
  cashRefundsCents: number;
  expectedCashCents: number;
}

export interface CashMovementItem {
  id: string;
  type: "in" | "out";
  amountCents: number;
  reason: string;
  userName: string | null;
  createdAt: string;
}

export interface CashSession {
  id: string;
  locationId: string;
  locationName: string;
  status: "open" | "closed";
  openedAt: string;
  openedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  openingCashCents: number;
  /** Only after closing (blind count). */
  countedCashCents: number | null;
  expectedCashCents: number | null;
  differenceCents: number | null;
  note: string | null;
  totals: CashSessionTotals | null;
  movements: CashMovementItem[];
}

export interface DashboardData {
  today: string;
  sales: { count: number; totalCents: number; avgTicketCents: number; grossProfitCents: number | null; yesterdayTotalCents: number; onlineCount: number; onlineTotalCents: number };
  /** Online orders waiting to be handled (null when the store is off). */
  orders: { pending: number; open: number } | null;
  days: Array<{ date: string; totalCents: number; count: number }>;
  topProducts: Array<{ productId: string; name: string; options: string[]; quantity: number; unit: UnitCode; totalCents: number }>;
  openSessions: Array<{ id: string; locationName: string; openedBy: string | null; openedAt: string }>;
}

/* ---------- Phase 3 ---------- */

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: string | null;
  paymentTermsDays: number;
  notes: string | null;
  active: boolean;
  createdAt: string;
  /** Orders that are not draft or cancelled, and the net value received from this supplier. */
  ordersCount?: number;
  openOrdersCount?: number;
  receivedCents?: number;
  lastOrderAt?: string | null;
}

/** A variant found by the product picker of purchases, transfers and counts. */
export interface LookupVariant {
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  barcode: string | null;
  unit: UnitCode;
  image: string | null;
  /** Average cost; null without costs:read. */
  costCents: number | null;
  /** Effective tax rate of the product. */
  taxRateBps: number;
  /** Stock in the requested location (decimal units). */
  stock: number;
  minStock: number;
  exact: boolean;
}

export interface PurchaseSuggestion extends LookupVariant {
  suggestedQuantity: number;
}

export interface PurchaseOrderListItem {
  id: string;
  number: number;
  status: PurchaseStatus;
  supplierId: string;
  supplierName: string;
  locationName: string;
  expectedDate: string | null;
  totalCents: number;
  receivedCents: number;
  itemsCount: number;
  /** Ordered and received quantity over all lines, 0–1. */
  progress: number;
  createdAt: string;
  orderedAt: string | null;
}

export interface PurchaseOrderItem {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  unit: UnitCode;
  quantity: number;
  receivedQuantity: number;
  unitCostCents: number;
  taxRateBps: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  /** Current stock at the order's location, for context while editing or receiving. */
  stock: number;
  /** Current average cost, to spot price changes. */
  currentCostCents: number;
}

export interface PurchaseReceipt {
  id: string;
  createdAt: string;
  userName: string | null;
  supplierReference: string | null;
  note: string | null;
  totalCents: number;
  /** Due date of the invoice from the supplier's credit days. */
  dueDate: string;
  items: Array<{ orderItemId: string; name: string; options: string[]; unit: UnitCode; quantity: number; unitCostCents: number }>;
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderListItem, "itemsCount" | "progress" | "supplierName"> {
  supplier: Supplier;
  locationId: string;
  note: string | null;
  subtotalCents: number;
  taxCents: number;
  createdByName: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: PurchaseOrderItem[];
  receipts: PurchaseReceipt[];
  progress: number;
}

export interface TransferListItem {
  id: string;
  number: number;
  status: TransferStatus;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  itemsCount: number;
  units: number;
  createdAt: string;
  createdByName: string | null;
  sentAt: string | null;
  receivedAt: string | null;
}

export interface TransferItem {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  unit: UnitCode;
  quantity: number;
  receivedQuantity: number | null;
  unitCostCents: number | null;
  /** Current stock at the origin (to check availability before sending). */
  originStock: number;
}

export interface TransferDetail extends TransferListItem {
  note: string | null;
  sentByName: string | null;
  receivedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  items: TransferItem[];
}

export interface StockCountSummary {
  lines: number;
  counted: number;
  adjusted: number;
  /** Net units of difference (decimal) and their value at average cost. */
  unitsOver: number;
  unitsShort: number;
  valueDeltaCents: number | null;
}

export interface StockCountListItem {
  id: string;
  number: number;
  status: CountStatus;
  locationId: string;
  locationName: string;
  scope: "all" | "category" | "manual";
  categoryName: string | null;
  lines: number;
  counted: number;
  createdAt: string;
  createdByName: string | null;
  completedAt: string | null;
  summary: StockCountSummary | null;
}

export interface StockCountItem {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  barcode: string | null;
  unit: UnitCode;
  /** null when hidden (blind count for users without counts:write). */
  expectedQuantity: number | null;
  countedQuantity: number | null;
  countedByName: string | null;
  /** After completion: the applied difference. */
  finalDelta: number | null;
  unitCostCents: number | null;
}

export interface StockCountDetail extends StockCountListItem {
  note: string | null;
  completedByName: string | null;
  /** True when the viewer sees expected stock and differences. */
  showExpected: boolean;
  items: StockCountItem[];
}

/* ---------- Phase 4: online store ---------- */

export interface StoreSettings {
  enabled: boolean;
  cardEnabled: boolean;
  locationId: string | null;
  tagline: string | null;
  about: string | null;
  pickupEnabled: boolean;
  pickupInstructions: string | null;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryFromCents: number | null;
  deliveryArea: string | null;
  minOrderCents: number;
  payOnDelivery: boolean;
  transferEnabled: boolean;
  transferInstructions: string | null;
  whatsapp: string | null;
  notifyEmail: string | null;
  holdHours: number;
  seoTitle: string | null;
  seoDescription: string | null;
  indexable: boolean;
  faq: Array<{ q: string; a: string }>;
  /** Customers sign in (or sign up) to place an order. */
  accountRequired: boolean;
  /** Read-only: public address of the store and how many products are published. */
  slug: string;
  url: string;
  publishedCount: number;
  activeCount: number;
}

/** Public view of a business's store. */
export interface StoreInfo {
  slug: string;
  name: string;
  tagline: string | null;
  about: string | null;
  logo: string | null;
  currency: string;
  locale: string;
  pricesIncludeTax: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  whatsapp: string | null;
  pickupEnabled: boolean;
  pickupInstructions: string | null;
  pickupAddress: string | null;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryFromCents: number | null;
  deliveryArea: string | null;
  minOrderCents: number;
  payOnDelivery: boolean;
  transferEnabled: boolean;
  /** Card payments through Stripe are available right now. */
  cardEnabled: boolean;
  categories: Array<{ id: string; name: string; count: number }>;
  /** Live online promotions, so the cart prices exactly like the server. */
  promotions: PromotionRule[];
  /** True when at least one coupon is active (shows the coupon field). */
  couponsEnabled: boolean;
  faq: Array<{ q: string; a: string }>;
  /** Published legal pages with their current version (the checkout asks to accept terms + privacy). */
  policies: Array<{ kind: import("./legal").PolicyKind; version: number }>;
  seoTitle: string | null;
  seoDescription: string | null;
  indexable: boolean;
  /** Active own domain, when the store has one (canonical URLs point there). */
  domain: string | null;
  /** Theme, announcement bar, banners and pixels (Phase 9). */
  appearance: import("./appearance").PublicAppearance;
  /** Paying needs a customer account (browsing and the cart do not). */
  accountRequired: boolean;
}

/** The signed-in customer of a store (its own account, one per business). */
export interface StoreAccount {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  acceptsMarketing: boolean;
  createdAt: string;
}

/** An order in "Mis pedidos". The token opens its tracking page. */
export interface StoreAccountOrder {
  number: number;
  token: string;
  status: import("./store").OrderStatus;
  paymentStatus: string;
  paymentMethod: string;
  fulfillment: import("./store").Fulfillment;
  totalCents: number;
  items: number;
  createdAt: string;
}

export interface StorePolicy {
  kind: import("./legal").PolicyKind;
  content: string;
  version: number;
  published: boolean;
  updatedAt: string;
}

/** One entry of the platform-wide sitemap index. */
export interface StoreIndexEntry {
  slug: string;
  domain: string | null;
  updatedAt: string;
}

export interface StoreVariant {
  id: string;
  options: string[];
  sku: string;
  /** Price before tax handling, as stored. */
  priceCents: number;
  /** What the customer pays per unit (with tax), before promotions. */
  displayPriceCents: number;
  /** null when the product does not track inventory (always available). */
  available: number | null;
}

export interface StoreProductCard {
  id: string;
  name: string;
  image: string | null;
  categoryId: string | null;
  /** Lowest display price of its variants (after any promotion); `priceVaries` when they differ. */
  fromPriceCents: number;
  /** Price before the promotion, when one applies. */
  compareAtCents: number | null;
  priceVaries: boolean;
  soldOut: boolean;
  lowStock: boolean;
}

export interface StoreProduct {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  categoryId: string | null;
  categoryName: string | null;
  brandName: string | null;
  unit: UnitCode;
  optionNames: string[];
  taxRateBps: number;
  /** Promotion that applies to this product, if any. */
  promotion: { id: string; name: string; percentBps: number } | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
  variants: StoreVariant[];
}

export interface OrderItem {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  unit: UnitCode;
  image: string | null;
  quantity: number;
  unitPriceCents: number;
  taxRateBps: number;
  totalCents: number;
}

/** What the customer sees on the tracking page. */
export interface PublicOrder {
  number: number;
  status: import("./store").OrderStatus;
  fulfillment: import("./store").Fulfillment;
  paymentMethod: import("./store").OnlinePaymentMethod;
  paymentStatus: "pending" | "paid";
  customerName: string;
  address: string | null;
  notes: string | null;
  items: OrderItem[];
  subtotalCents: number;
  /** Promotions and coupon. */
  discountCents: number;
  couponCode: string | null;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  createdAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  canCancel: boolean;
  /** Card order still waiting for the customer to pay in Stripe Checkout. */
  awaitingCardPayment: boolean;
  transferInstructions: string | null;
  pickupInstructions: string | null;
  pickupAddress: string | null;
}

export interface OrderListItem {
  id: string;
  number: number;
  status: import("./store").OrderStatus;
  fulfillment: import("./store").Fulfillment;
  paymentMethod: import("./store").OnlinePaymentMethod;
  paymentStatus: "pending" | "paid";
  customerName: string;
  customerPhone: string;
  itemsCount: number;
  totalCents: number;
  createdAt: string;
}

export interface OrderDetail extends Omit<PublicOrder, "canCancel" | "transferInstructions" | "pickupInstructions" | "pickupAddress"> {
  id: string;
  token: string;
  trackingUrl: string;
  locationId: string;
  locationName: string;
  customerEmail: string;
  customerPhone: string;
  paidMethod: string | null;
  paidReference: string | null;
  paidAt: string | null;
  costCents: number | null;
  completedByName: string | null;
  cancelledBy: "customer" | "staff" | "system" | null;
  /** When the customer accepted the terms and privacy notice, and which versions. */
  legal: { acceptedAt: string; termsVersion: number | null; privacyVersion: number | null } | null;
}

/* ---------- Phase 5 ---------- */

export interface CustomerStats {
  purchases: number;
  totalCents: number;
  lastPurchaseAt: string | null;
  avgTicketCents: number;
}

export interface Customer extends CustomerStats {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: string | null;
  notes: string | null;
  acceptsMarketing: boolean;
  source: "admin" | "pos" | "online";
  archived: boolean;
  createdAt: string;
  /** Has an account in the online store (when it was created). */
  accountSince?: string | null;
}

export interface CustomerHistoryItem {
  kind: "sale" | "order";
  id: string;
  number: number;
  date: string;
  totalCents: number;
  status: string;
  items: number;
  channelLabel: string;
}

export interface CustomerDetail extends Customer {
  history: CustomerHistoryItem[];
  topProducts: Array<{ productId: string; name: string; quantity: number; unit: UnitCode; totalCents: number }>;
}

export interface Promotion extends PromotionRule {
  /** Names of the categories or products it applies to. */
  targetNames: string[];
  /** Uses so far (sale and order lines). */
  uses: number;
  discountGivenCents: number;
}

export interface Coupon extends CouponRule {
  id: string;
  description: string | null;
  /** Total of the sales and delivered orders that used it. */
  salesCents: number;
}

export interface Payable {
  receiptId: string;
  orderId: string;
  orderNumber: number;
  supplierId: string;
  supplierName: string;
  supplierReference: string | null;
  receivedAt: string;
  dueDate: string | null;
  amountDueCents: number;
  paidCents: number;
  balanceCents: number;
  /** Days until due (negative = overdue). null without due date. */
  daysToDue: number | null;
  payments: Array<{ id: string; amountCents: number; method: string; reference: string | null; paidOn: string; userName: string | null; note: string | null }>;
}

export interface PayablesSummary {
  openCents: number;
  overdueCents: number;
  dueSoonCents: number;
  bySupplier: Array<{ supplierId: string; supplierName: string; balanceCents: number; overdueCents: number }>;
}

/** Period report. Money in cents; quantities in units. */
export interface SalesReport {
  from: string;
  to: string;
  totals: {
    count: number;
    grossCents: number;
    discountCents: number;
    promoDiscountCents: number;
    returnsCents: number;
    netCents: number;
    taxCents: number;
    costCents: number | null;
    profitCents: number | null;
    avgTicketCents: number;
    onlineCount: number;
    onlineCents: number;
    voidedCount: number;
  };
  previous: { netCents: number; count: number };
  days: Array<{ date: string; netCents: number; count: number }>;
  products: Array<{ productId: string; variantId: string; name: string; options: string[]; sku: string; unit: UnitCode; quantity: number; netCents: number; costCents: number | null; profitCents: number | null }>;
  categories: Array<{ categoryId: string | null; name: string; quantity: number; netCents: number; profitCents: number | null }>;
  payments: Array<{ method: string; label: string; count: number; amountCents: number }>;
  cashiers: Array<{ userId: string | null; name: string; count: number; netCents: number; discountCents: number }>;
  hours: Array<{ hour: number; count: number; netCents: number }>;
  coupons: Array<{ code: string; uses: number; salesCents: number }>;
}

export interface InventoryReport {
  valuation: Array<{ categoryId: string | null; name: string; units: number; costCents: number; retailCents: number }>;
  totalCostCents: number;
  totalRetailCents: number;
  /** Products with stock and no sales in `days` days. */
  stale: Array<{ productId: string; variantId: string; name: string; options: string[]; unit: UnitCode; stock: number; costCents: number; lastSaleAt: string | null }>;
  days: number;
}

/* ---------- Phase 6: SaaS ---------- */

export interface BillingInfo {
  plan: import("./plans").PlanId;
  planStatus: "active" | "trialing" | "past_due" | "canceled";
  periodEnd: string | null;
  hasSubscription: boolean;
  /** Stripe keys configured on the platform (otherwise upgrading is not possible yet). */
  billingAvailable: boolean;
  usage: { users: number; locations: number; products: number };
}

export interface StripeConnectStatus {
  available: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  /** The plan allows card payments. */
  planAllows: boolean;
}

export interface StoreDomain {
  hostname: string;
  status: "pending" | "active" | "failed";
  sslStatus: string | null;
  verification: Array<{ type: string; name: string; value: string }>;
  /** Where the customer must point the domain (CNAME). */
  target: string;
  lastError: string | null;
  checkedAt: string | null;
}

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  status: "provisioning" | "active" | "suspended" | "migrating";
  plan: import("./plans").PlanId;
  planStatus: string;
  dbBinding: string;
  createdAt: string;
  owner: { name: string; email: string } | null;
  members: number;
  domains: string[];
  suspendedReason: string | null;
  /** Support tickets not closed yet. */
  openTickets: number;
}

export interface PlatformTenantDetail extends PlatformTenant {
  usage: { users: number; locations: number; products: number; sales30d: number; sales30dCents: number; orders30d: number };
  currency: string;
  stripeCustomerId: string | null;
  stripeAccountId: string | null;
  planPeriodEnd: string | null;
  availableBindings: string[];
  people: Array<{ id: string; name: string; email: string; role: Role; active: boolean; disabled: boolean; lastLoginAt: string | null }>;
  tickets: import("./platform").SupportTicket[];
  log: import("./platform").PlatformAuditEntry[];
}
