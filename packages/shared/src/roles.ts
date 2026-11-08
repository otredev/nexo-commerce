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
  /** API keys, webhooks and AI assistants (Phase 11). */
  "integrations:manage": ["owner", "admin"],
  /** Support tickets with the Nexo team. */
  "support:use": ["owner", "admin"],
  /** Cash closing: see the expected cash and the difference (cashiers count blind). */
  "cash:review": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Only the owner: never part of a custom role. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ["billing:write"];
/** What a custom role can include. */
export const ASSIGNABLE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !OWNER_ONLY_PERMISSIONS.includes(p));

/** Permissions of a built-in role. */
export const rolePermissions = (role: Role): Permission[] => ALL_PERMISSIONS.filter((p) => can(role, p));

/**
 * Effective permissions of a member: the custom role's when it has one (never owner-only ones),
 * otherwise the built-in role's. The owner always has everything.
 */
export function effectivePermissions(role: Role, custom: readonly string[] | null | undefined): Permission[] {
  if (role === "owner" || !custom) return rolePermissions(role);
  const set = new Set(custom);
  return ASSIGNABLE_PERMISSIONS.filter((p) => set.has(p));
}

/** The permission catalog as the role editor shows it: grouped, in Spanish, in a sensible order. */
export const PERMISSION_GROUPS: Array<{ id: string; label: string; items: Array<{ id: Permission; label: string; help?: string }> }> = [
  {
    id: "pos", label: "Punto de venta y caja",
    items: [
      { id: "pos:sell", label: "Vender en la caja" },
      { id: "cash:operate", label: "Abrir y cerrar caja, ingresos y retiros" },
      { id: "cash:review", label: "Ver el efectivo esperado y la diferencia del corte", help: "Sin este permiso el corte es a ciegas." },
      { id: "discount:unlimited", label: "Descuentos sin límite", help: "Sin él aplica el límite de descuento de Configuración." },
      { id: "sales:read", label: "Ver ventas" },
      { id: "sales:void", label: "Anular ventas" },
      { id: "sales:return", label: "Hacer devoluciones" },
    ],
  },
  {
    id: "catalog", label: "Catálogo e inventario",
    items: [
      { id: "catalog:read", label: "Ver productos" },
      { id: "catalog:write", label: "Crear y editar productos, categorías y marcas" },
      { id: "uploads:write", label: "Subir imágenes" },
      { id: "inventory:read", label: "Ver existencias y movimientos" },
      { id: "inventory:write", label: "Ajustar existencias" },
      { id: "costs:read", label: "Ver costos, márgenes y valor del inventario" },
      { id: "counts:read", label: "Ver conteos físicos" },
      { id: "counts:count", label: "Capturar conteos físicos" },
      { id: "counts:write", label: "Iniciar, terminar y cancelar conteos (ver diferencias)" },
      { id: "transfers:read", label: "Ver traspasos" },
      { id: "transfers:write", label: "Crear y enviar traspasos" },
      { id: "transfers:receive", label: "Recibir traspasos" },
    ],
  },
  {
    id: "purchasing", label: "Abastecimiento",
    items: [
      { id: "suppliers:read", label: "Ver proveedores" },
      { id: "suppliers:write", label: "Crear y editar proveedores" },
      { id: "purchases:read", label: "Ver órdenes de compra" },
      { id: "purchases:write", label: "Crear y editar órdenes de compra" },
      { id: "purchases:receive", label: "Recibir mercancía" },
      { id: "payables:read", label: "Ver cuentas por pagar" },
      { id: "payables:write", label: "Registrar pagos a proveedores" },
    ],
  },
  {
    id: "store", label: "Tienda en línea",
    items: [
      { id: "orders:read", label: "Ver pedidos" },
      { id: "orders:fulfill", label: "Aceptar, preparar y entregar pedidos" },
      { id: "orders:cancel", label: "Cancelar pedidos" },
      { id: "store:write", label: "Ajustes y apariencia de la tienda" },
    ],
  },
  {
    id: "customers", label: "Clientes y promociones",
    items: [
      { id: "customers:read", label: "Ver clientes" },
      { id: "customers:write", label: "Crear y editar clientes" },
      { id: "promotions:read", label: "Ver promociones y cupones" },
      { id: "promotions:write", label: "Crear y editar promociones y cupones" },
    ],
  },
  {
    id: "business", label: "Negocio",
    items: [
      { id: "reports:read", label: "Ver reportes y estadísticas" },
      { id: "settings:read", label: "Ver la configuración" },
      { id: "settings:write", label: "Cambiar la configuración del negocio" },
      { id: "locations:write", label: "Crear y editar ubicaciones" },
      { id: "taxes:write", label: "Crear y editar impuestos" },
      { id: "users:read", label: "Ver usuarios" },
      { id: "users:write", label: "Invitar usuarios y cambiar roles", help: "Solo puede dar los permisos que él mismo tiene." },
      { id: "audit:read", label: "Ver la actividad" },
      { id: "integrations:manage", label: "Llaves de API, webhooks y asistentes de IA" },
      { id: "support:use", label: "Escribir a soporte de Nexo" },
    ],
  },
];
