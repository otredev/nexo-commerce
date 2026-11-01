import type { Role } from "./roles";

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
