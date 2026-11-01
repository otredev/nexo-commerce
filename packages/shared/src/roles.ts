/**
 * Roles of a user inside a business (tenant).
 * - owner: created the business. Cannot be removed or demoted.
 * - admin: full access to administration.
 * - cashier: point of sale and read-only catalog.
 */
export const ROLES = ["owner", "admin", "cashier"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  cashier: "Cajero",
};

/** Permissions are checked by name so they can become granular later (Phase 5) without touching routes. */
export const PERMISSIONS = {
  "settings:read": ["owner", "admin", "cashier"],
  "settings:write": ["owner", "admin"],
  /** Plan, subscription and the Stripe account that receives store payments. Owner only. */
  "billing:write": ["owner"],
  "users:read": ["owner", "admin"],
  "users:write": ["owner", "admin"],
  "locations:write": ["owner", "admin"],
  "taxes:write": ["owner", "admin"],
  "audit:read": ["owner", "admin"],
  "uploads:write": ["owner", "admin"],
  "catalog:read": ["owner", "admin", "cashier"],
  "catalog:write": ["owner", "admin"],
  "inventory:read": ["owner", "admin", "cashier"],
  "inventory:write": ["owner", "admin"],
  /** Purchase cost, margins and inventory value. Hidden from cashiers. */
  "costs:read": ["owner", "admin"],
  "pos:sell": ["owner", "admin", "cashier"],
  "cash:operate": ["owner", "admin", "cashier"],
  "sales:read": ["owner", "admin", "cashier"],
  "sales:void": ["owner", "admin"],
  "sales:return": ["owner", "admin"],
  /** Discounts above the business's cashier limit. */
  "discount:unlimited": ["owner", "admin"],
  "reports:read": ["owner", "admin"],
  "suppliers:read": ["owner", "admin"],
  "suppliers:write": ["owner", "admin"],
  /** Purchase orders show costs, so they stay with owners and admins. */
  "purchases:read": ["owner", "admin"],
  "purchases:write": ["owner", "admin"],
  "purchases:receive": ["owner", "admin"],
  "transfers:read": ["owner", "admin", "cashier"],
  "transfers:write": ["owner", "admin"],
  /** Staff at the destination confirm what arrived. */
  "transfers:receive": ["owner", "admin", "cashier"],
  "counts:read": ["owner", "admin", "cashier"],
  /** Enter counted quantities. Without counts:write the expected stock stays hidden (blind count). */
  "counts:count": ["owner", "admin", "cashier"],
  /** Start, complete and cancel counts; see expected stock and differences. */
  "counts:write": ["owner", "admin"],
  /** Online orders: everyone sees and prepares them; cancelling (stock and money back) is for admins. */
  "orders:read": ["owner", "admin", "cashier"],
  "orders:fulfill": ["owner", "admin", "cashier"],
  "orders:cancel": ["owner", "admin"],
  "store:write": ["owner", "admin"],
  /** Customers: cashiers find and create them at the register. */
  "customers:read": ["owner", "admin", "cashier"],
  "customers:write": ["owner", "admin", "cashier"],
  "promotions:read": ["owner", "admin", "cashier"],
  "promotions:write": ["owner", "admin"],
  /** Supplier invoices and payments. */
  "payables:read": ["owner", "admin"],
  "payables:write": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
