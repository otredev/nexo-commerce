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
