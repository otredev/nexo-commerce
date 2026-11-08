import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, CircleHelp, LifeBuoy, LogOut, Menu, MessageCircleQuestionMark, Search } from "lucide-react";
import { helpLinkFor } from "../lib/helpLinks";
import { NAV } from "./nav";
import { CommandPalette, shortcutLabel } from "./CommandPalette";
import { ROLE_LABELS, type MeResponse } from "@nexo/shared";
import { Avatar, Button } from "@nexo/ui";
import { get, post } from "../lib/api";
import { useAuth } from "../lib/auth";


const NAV_COLLAPSED_KEY = "nx.nav.collapsed";

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
  [/^\/ayuda$/, "Ayuda"],
  [/^\/usuarios$/, "Usuarios"],
  [/^\/actividad$/, "Actividad"],
  [/^\/configuracion$/, "Configuración"],
  [/^\/soporte\/.+/, "Ticket de soporte"],
  [/^\/soporte$/, "Soporte"],
];
const titleFor = (path: string) => TITLES.find(([re]) => re.test(path))?.[1] ?? "";

export function AppLayout() {
  const { me, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  // Sidebar sections the person folded, remembered in this browser.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(NAV_COLLAPSED_KEY) ?? "{}") as Record<string, boolean>; } catch { return {}; }
  });
  const toggleGroup = (group: string) =>
    setCollapsed((all) => {
      const next = { ...all, [group]: !all[group] };
      try { localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
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
  const isActive = (to: string, end?: boolean) => {
    const [path, query] = to.split("?");
    if (query) return location.pathname === path && location.search.includes(query);
    return end || path === "/" ? location.pathname === path : location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <div className="nx-shell">
      {open && <div className="nx-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className="nx-sidebar" data-open={open} aria-label="Navegación principal">
        <a className="nx-brand" href="/">
          <span className="nx-brand-dot" aria-hidden="true" />
          Nexo
        </a>
        {NAV.map((section, i) => {
          const all = section.items.filter((item) => !item.permission || can(item.permission));
          if (!all.length) return null;
          const group = section.group;
          const isCollapsed = Boolean(group && collapsed[group]);
          // A collapsed group still shows the page you are on, so you never lose where you are.
          const items = isCollapsed ? all.filter((item) => isActive(item.to, item.end)) : all;
          const hiddenBadge = isCollapsed && newOrders > 0 && all.some((item) => item.badge === "orders" && !items.includes(item));
          const listId = `nx-nav-${i}`;
          return (
            <nav className="nx-nav" key={i} aria-label={group ?? "Principal"}>
              {group && (
                <button type="button" className="nx-nav__group" aria-expanded={!isCollapsed} aria-controls={listId} onClick={() => toggleGroup(group)}>
                  <span>{group}</span>
                  {hiddenBadge && <span className="nx-nav__badge" aria-label={`${newOrders} pedidos nuevos`}>{newOrders}</span>}
                  <ChevronDown className="nx-nav__chevron" aria-hidden="true" />
                </button>
              )}
              <div id={listId} className="nx-nav__list">
              {items.map(({ to, label, icon: Icon, end, badge }) => (
                <NavLink key={to} to={to} end={end} className="nx-nav__item">
                  <Icon className="nx-icon" aria-hidden="true" />
                  {label}
                  {badge === "orders" && newOrders > 0 && <span className="nx-nav__badge" aria-label={`${newOrders} nuevos`}>{newOrders}</span>}
                </NavLink>
              ))}
              </div>
            </nav>
          );
        })}
        <div className="nx-sidebar__footer nx-nav">
          <NavLink to="/ayuda" className="nx-nav__item">
            <LifeBuoy className="nx-icon" aria-hidden="true" />
            Ayuda
          </NavLink>
          {can("support:use") && (
            <NavLink to="/soporte" className="nx-nav__item">
              <MessageCircleQuestionMark className="nx-icon" aria-hidden="true" />
              Soporte
              {(me.supportWaiting ?? 0) > 0 && <span className="nx-nav__badge" aria-label={`${me.supportWaiting} respuestas de soporte`}>{me.supportWaiting}</span>}
            </NavLink>
          )}
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
        {me.support && <SupportBanner info={me.support} tenant={me.tenant.name} />}
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
            <NavLink to={helpLinkFor(location.pathname, location.search)} className="nx-help-trigger" aria-label="Ayuda de esta página" title="Ayuda de esta página">
              <CircleHelp className="nx-icon" aria-hidden="true" />
            </NavLink>
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

/**
 * Shown while an operator is inside the business from /admin ("Entrar como negocio"): who, until when,
 * and the way out. Everything done meanwhile is logged under the operator's name.
 */
function SupportBanner({ info, tenant }: { info: NonNullable<MeResponse["support"]>; tenant: string }) {
  const [left, setLeft] = useState(() => new Date(info.expiresAt).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setLeft(new Date(info.expiresAt).getTime() - Date.now()), 15_000);
    return () => clearInterval(id);
  }, [info.expiresAt]);
  const exit = async () => {
    const res = await post<{ redirect: string }>("/auth/support/exit").catch(() => ({ redirect: "/admin/" }));
    window.location.href = res.redirect;
  };
  const minutes = Math.max(0, Math.ceil(left / 60_000));
  return (
    <div className="nx-support-banner" role="status">
      <span>
        <strong>Modo soporte</strong> · {info.operatorName} está viendo <strong>{tenant}</strong> como su propietario{info.ticketNumber ? ` (ticket #${info.ticketNumber})` : ""}. Todo queda en Actividad. {minutes > 0 ? `Quedan ${minutes} min.` : "La sesión terminó."}
      </span>
      <Button size="sm" onClick={() => void exit()}>Salir del modo soporte</Button>
    </div>
  );
}
