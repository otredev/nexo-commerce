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
  "users:read": ["owner", "admin"],
  "users:write": ["owner", "admin"],
  "locations:write": ["owner", "admin"],
  "taxes:write": ["owner", "admin"],
  "audit:read": ["owner", "admin"],
  "uploads:write": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
