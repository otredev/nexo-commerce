import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu, Search } from "lucide-react";
import { NAV } from "./nav";
import { CommandPalette, shortcutLabel } from "./CommandPalette";
import { ROLE_LABELS } from "@nexo/shared";
import { Avatar, Button } from "@nexo/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";


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
  [/^\/tienda\/apariencia$/, "Apariencia de la tienda"],
  [/^\/tienda\/estadisticas$/, "Estadísticas de la tienda"],
  [/^\/usuarios$/, "Usuarios"],
  [/^\/actividad$/, "Actividad"],
  [/^\/configuracion$/, "Configuración"],
  [/^\/plataforma$/, "Plataforma"],
];
const titleFor = (path: string) => TITLES.find(([re]) => re.test(path))?.[1] ?? "";

export function AppLayout() {
  const { me, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Ctrl+K / ⌘K opens the search from anywhere in the dashboard.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const location = useLocation();
  // Keep the current page visible in a long sidebar.
  useEffect(() => {
    document.querySelector<HTMLElement>('.nx-sidebar .nx-nav__item[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [location.pathname]);
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
            <button type="button" className="nx-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buscar" aria-keyshortcuts="Control+K Meta+K">
              <Search className="nx-icon" aria-hidden="true" />
              <span className="nx-search-trigger__text">Buscar…</span>
              <kbd className="nx-kbd nx-search-trigger__kbd">{shortcutLabel()}</kbd>
            </button>
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
        {searchOpen && <CommandPalette open onClose={() => setSearchOpen(false)} />}
      </div>
    </div>
  );
}
