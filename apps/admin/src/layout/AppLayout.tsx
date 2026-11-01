import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Activity, ArrowLeftRight, Building2, BarChart3, Boxes, Contact, Landmark, Percent, ClipboardCheck, ClipboardList, Globe, Home, LogOut, Menu, Package, Receipt, Settings, ShoppingBag, ShoppingCart, Tags, Truck, Users, Wallet, Warehouse } from "lucide-react";
import { ROLE_LABELS, type Permission } from "@nexo/shared";
import { Avatar, Button } from "@nexo/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";

type NavItem = { to: string; label: string; icon: typeof Home; permission?: Permission; end?: boolean; badge?: "orders"; platform?: boolean };
const NAV: Array<{ group?: string; items: NavItem[] }> = [
  {
    items: [
      { to: "/", label: "Inicio", icon: Home, end: true },
      { to: "/pos", label: "Punto de venta", icon: ShoppingCart, permission: "pos:sell" },
      { to: "/reportes", label: "Reportes", icon: BarChart3, permission: "reports:read" },
    ],
  },
  {
    group: "Ventas",
    items: [
      { to: "/ventas", label: "Ventas", icon: Receipt, permission: "sales:read" },
      { to: "/caja", label: "Cortes de caja", icon: Wallet, permission: "cash:operate" },
      { to: "/clientes", label: "Clientes", icon: Contact, permission: "customers:read" },
      { to: "/promociones", label: "Promociones", icon: Percent, permission: "promotions:read" },
    ],
  },
  {
    group: "Tienda en línea",
    items: [
      { to: "/pedidos", label: "Pedidos", icon: ShoppingBag, permission: "orders:read", badge: "orders" },
      { to: "/tienda", label: "Ajustes de la tienda", icon: Globe, permission: "store:write" },
    ],
  },
  {
    group: "Catálogo",
    items: [
      { to: "/productos", label: "Productos", icon: Package, permission: "catalog:read" },
      { to: "/inventario", label: "Inventario", icon: Boxes, permission: "inventory:read", end: true },
      { to: "/inventario/movimientos", label: "Movimientos", icon: ArrowLeftRight, permission: "inventory:read" },
      { to: "/catalogo", label: "Categorías y marcas", icon: Tags, permission: "catalog:read" },
    ],
  },
  {
    group: "Abastecimiento",
    items: [
      { to: "/compras", label: "Compras", icon: ClipboardList, permission: "purchases:read" },
      { to: "/proveedores", label: "Proveedores", icon: Warehouse, permission: "suppliers:read" },
      { to: "/cuentas-por-pagar", label: "Cuentas por pagar", icon: Landmark, permission: "payables:read" },
      { to: "/traspasos", label: "Traspasos", icon: Truck, permission: "transfers:read" },
      { to: "/conteos", label: "Conteos físicos", icon: ClipboardCheck, permission: "counts:read" },
    ],
  },
  {
    group: "Negocio",
    items: [
      { to: "/usuarios", label: "Usuarios", icon: Users, permission: "users:read" },
      { to: "/actividad", label: "Actividad", icon: Activity, permission: "audit:read" },
      { to: "/configuracion", label: "Configuración", icon: Settings },
    ],
  },
  {
    group: "Plataforma",
    items: [{ to: "/plataforma", label: "Negocios", icon: Building2, platform: true }],
  },
];

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Inicio"],
  [/^\/productos\/nuevo$/, "Nuevo producto"],
  [/^\/productos\/.+/, "Producto"],
  [/^\/productos$/, "Productos"],
  [/^\/inventario\/movimientos$/, "Movimientos"],
  [/^\/inventario$/, "Inventario"],
  [/^\/catalogo$/, "Categorías y marcas"],
  [/^\/ventas\/.+/, "Venta"],
  [/^\/ventas$/, "Ventas"],
  [/^\/caja\/.+/, "Corte de caja"],
  [/^\/caja$/, "Cortes de caja"],
  [/^\/compras\/nueva$/, "Nueva orden"],
  [/^\/compras\/.+/, "Orden de compra"],
  [/^\/compras$/, "Compras"],
  [/^\/proveedores$/, "Proveedores"],
  [/^\/traspasos\/nuevo$/, "Nuevo traspaso"],
  [/^\/traspasos\/.+/, "Traspaso"],
  [/^\/traspasos$/, "Traspasos"],
  [/^\/conteos\/.+/, "Conteo físico"],
  [/^\/conteos$/, "Conteos físicos"],
  [/^\/clientes\/.+/, "Cliente"],
  [/^\/clientes$/, "Clientes"],
  [/^\/promociones$/, "Promociones"],
  [/^\/cuentas-por-pagar$/, "Cuentas por pagar"],
  [/^\/reportes$/, "Reportes"],
  [/^\/pedidos\/.+/, "Pedido"],
  [/^\/pedidos$/, "Pedidos en línea"],
  [/^\/tienda$/, "Tienda en línea"],
  [/^\/usuarios$/, "Usuarios"],
  [/^\/actividad$/, "Actividad"],
  [/^\/configuracion$/, "Configuración"],
  [/^\/plataforma$/, "Plataforma"],
];
const titleFor = (path: string) => TITLES.find(([re]) => re.test(path))?.[1] ?? "";

export function AppLayout() {
  const { me, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [location.pathname]);
  // New online orders, refreshed every minute and on every page change.
  const [newOrders, setNewOrders] = useState(0);
  const canOrders = Boolean(me) && can("orders:read");
  useEffect(() => {
    if (!canOrders) return;
    let alive = true;
    const load = () => get<{ pending: number }>("/orders/counts").then((r) => alive && setNewOrders(r.pending), () => {});
    void load();
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [canOrders, location.pathname]);
  if (!me) return null;

  return (
    <div className="nx-shell">
      {open && <div className="nx-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className="nx-sidebar" data-open={open} aria-label="Navegación principal">
        <a className="nx-brand" href="/">
          <span className="nx-brand-dot" aria-hidden="true" />
          Nexo
        </a>
        {NAV.map((section, i) => {
          const items = section.items.filter((item) => (!item.permission || can(item.permission)) && (!item.platform || me.platformAdmin));
          if (!items.length) return null;
          return (
            <nav className="nx-nav" key={i}>
              {section.group && <div className="nx-nav__group">{section.group}</div>}
              {items.map(({ to, label, icon: Icon, end, badge }) => (
                <NavLink key={to} to={to} end={end} className="nx-nav__item">
                  <Icon className="nx-icon" aria-hidden="true" />
                  {label}
                  {badge === "orders" && newOrders > 0 && <span className="nx-nav__badge" aria-label={`${newOrders} nuevos`}>{newOrders}</span>}
                </NavLink>
              ))}
            </nav>
          );
        })}
        <div className="nx-sidebar__footer nx-nav">
          <button
            type="button"
            className="nx-nav__item"
            style={{ border: 0, background: "none", cursor: "pointer", width: "100%" }}
            onClick={async () => {
              await logout();
              navigate("/ingresar");
            }}
          >
            <LogOut className="nx-icon" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="nx-main">
        <header className="nx-topbar">
          <div className="nx-topbar__left">
            <Button variant="ghost" size="sm" icon className="nx-mobile-only" aria-label="Abrir menú" onClick={() => setOpen((v) => !v)}>
              <Menu className="nx-icon" aria-hidden="true" />
            </Button>
            <nav className="nx-breadcrumb" aria-label="Ruta">
              <span>{me.tenant.name}</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{titleFor(location.pathname)}</span>
            </nav>
          </div>
          <div className="nx-topbar__right">
            <div className="nx-topbar__who">
              <div style={{ fontSize: 13, fontWeight: 500 }}>{me.user.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{ROLE_LABELS[me.role]}</div>
            </div>
            <Avatar name={me.user.name} />
          </div>
        </header>
        <main className="nx-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
