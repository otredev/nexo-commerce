import {
  Activity, ArrowLeftRight, BarChart3, Bell, Boxes, Building2, ClipboardCheck, ClipboardList, Contact, CreditCard, Globe, Home, KeyRound, Landmark, MapPin, Monitor, Package,
  PackagePlus, Percent, Receipt, Settings, ShoppingBag, ShoppingCart, Tags, Truck, UserPlus, Users, Wallet, Warehouse,
} from "lucide-react";
import type { Permission } from "@nexo/shared";

export type Icon = typeof Home;

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  permission?: Permission;
  end?: boolean;
  badge?: "orders";
  platform?: boolean;
  /** Extra words the Ctrl+K search matches (synonyms, what people type). */
  keywords?: string;
}

export const NAV: Array<{ group?: string; items: NavItem[] }> = [
  {
    items: [
      { to: "/", label: "Inicio", icon: Home, end: true, keywords: "dashboard tablero resumen hoy" },
      { to: "/pos", label: "Punto de venta", icon: ShoppingCart, permission: "pos:sell", keywords: "pos caja vender cobrar venta nueva ticket" },
      { to: "/reportes", label: "Reportes", icon: BarChart3, permission: "reports:read", keywords: "estadisticas utilidad ganancias graficas analisis" },
    ],
  },
  {
    group: "Ventas",
    items: [
      { to: "/ventas", label: "Ventas", icon: Receipt, permission: "sales:read", keywords: "historial tickets folios devoluciones anular" },
      { to: "/caja", label: "Cortes de caja", icon: Wallet, permission: "cash:operate", keywords: "corte arqueo efectivo apertura cierre" },
      { to: "/clientes", label: "Clientes", icon: Contact, permission: "customers:read", keywords: "compradores contactos" },
      { to: "/promociones", label: "Promociones", icon: Percent, permission: "promotions:read", keywords: "descuentos cupones ofertas rebajas" },
    ],
  },
  {
    group: "Tienda en línea",
    items: [
      { to: "/pedidos", label: "Pedidos", icon: ShoppingBag, permission: "orders:read", badge: "orders", keywords: "ordenes en linea web ecommerce envios" },
      { to: "/tienda", label: "Ajustes de la tienda", icon: Globe, permission: "store:write", keywords: "tienda online web dominio stripe tarjeta envio publicar" },
    ],
  },
  {
    group: "Catálogo",
    items: [
      { to: "/productos", label: "Productos", icon: Package, permission: "catalog:read", keywords: "articulos catalogo sku precios variantes importar csv" },
      { to: "/inventario", label: "Inventario", icon: Boxes, permission: "inventory:read", end: true, keywords: "existencias stock almacen" },
      { to: "/inventario/movimientos", label: "Movimientos", icon: ArrowLeftRight, permission: "inventory:read", keywords: "kardex entradas salidas ajustes" },
      { to: "/catalogo", label: "Categorías y marcas", icon: Tags, permission: "catalog:read", keywords: "categorias marcas familias" },
    ],
  },
  {
    group: "Abastecimiento",
    items: [
      { to: "/compras", label: "Compras", icon: ClipboardList, permission: "purchases:read", keywords: "ordenes de compra recepciones reorden" },
      { to: "/proveedores", label: "Proveedores", icon: Warehouse, permission: "suppliers:read", keywords: "distribuidores" },
      { to: "/cuentas-por-pagar", label: "Cuentas por pagar", icon: Landmark, permission: "payables:read", keywords: "facturas deudas pagos proveedores vencidas" },
      { to: "/traspasos", label: "Traspasos", icon: Truck, permission: "transfers:read", keywords: "transferencias entre sucursales" },
      { to: "/conteos", label: "Conteos físicos", icon: ClipboardCheck, permission: "counts:read", keywords: "inventario fisico auditoria conteo" },
    ],
  },
  {
    group: "Negocio",
    items: [
      { to: "/usuarios", label: "Usuarios", icon: Users, permission: "users:read", keywords: "empleados cajeros roles permisos equipo" },
      { to: "/actividad", label: "Actividad", icon: Activity, permission: "audit:read", keywords: "auditoria bitacora historial cambios" },
      { to: "/configuracion", label: "Configuración", icon: Settings, keywords: "ajustes negocio logotipo moneda zona horaria" },
    ],
  },
  {
    group: "Plataforma",
    items: [{ to: "/plataforma", label: "Negocios", icon: Building2, platform: true, keywords: "plataforma tenants suspender clientes saas" }],
  },
];

/** Shortcuts that only live in the Ctrl+K search. */
export const ACTIONS: NavItem[] = [
  { to: "/pos", label: "Nueva venta", icon: ShoppingCart, permission: "pos:sell", keywords: "vender cobrar caja" },
  { to: "/productos/nuevo", label: "Nuevo producto", icon: PackagePlus, permission: "catalog:write", keywords: "agregar crear articulo alta" },
  { to: "/compras/nueva", label: "Nueva orden de compra", icon: ClipboardList, permission: "purchases:write", keywords: "pedir proveedor comprar" },
  { to: "/traspasos/nuevo", label: "Nuevo traspaso", icon: Truck, permission: "transfers:write", keywords: "mover mercancia sucursal" },
  { to: "/clientes?nuevo=1", label: "Nuevo cliente", icon: UserPlus, permission: "customers:write", keywords: "agregar alta" },
  { to: "/configuracion?tab=impuestos", label: "Impuestos", icon: Percent, keywords: "iva tasas configuracion" },
  { to: "/configuracion?tab=ubicaciones", label: "Ubicaciones", icon: MapPin, keywords: "sucursales tiendas bodegas almacenes" },
  { to: "/configuracion?tab=plan", label: "Plan y facturación", icon: CreditCard, keywords: "suscripcion pagar plan pro negocio stripe" },
  { to: "/configuracion?tab=notificaciones", label: "Notificaciones push", icon: Bell, keywords: "avisos alertas celular pedidos resumen diario dispositivo" },
  { to: "/pantalla", label: "Pantalla del cliente (tablet o TV)", icon: Monitor, permission: "pos:sell", keywords: "monitor segunda pantalla cliente display emparejar codigo" },
  { to: "/configuracion?tab=seguridad", label: "Cambiar contraseña", icon: KeyRound, keywords: "seguridad password clave" },
];
