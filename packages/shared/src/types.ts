import type { Role } from "./roles";
import type { MovementType, StockStatus, UnitCode } from "./catalog";

/** Shapes returned by the API. Shared by the dashboard so both sides stay in sync. */

export interface MeResponse {
  user: { id: string; name: string; email: string };
  tenant: { id: string; slug: string; name: string };
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
  sales: { count: number; totalCents: number; avgTicketCents: number; grossProfitCents: number | null; yesterdayTotalCents: number };
  days: Array<{ date: string; totalCents: number; count: number }>;
  topProducts: Array<{ productId: string; name: string; options: string[]; quantity: number; unit: UnitCode; totalCents: number }>;
  openSessions: Array<{ id: string; locationName: string; openedBy: string | null; openedAt: string }>;
}
