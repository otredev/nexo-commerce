import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Activity, ArrowLeftRight, Boxes, Home, LogOut, Menu, Package, Settings, Tags, Users } from "lucide-react";
import { ROLE_LABELS, type Permission } from "@nexo/shared";
import { Avatar, Button } from "@nexo/ui";
import { useAuth } from "../lib/auth";

type NavItem = { to: string; label: string; icon: typeof Home; permission?: Permission; end?: boolean };
const NAV: Array<{ group?: string; items: NavItem[] }> = [
  { items: [{ to: "/", label: "Inicio", icon: Home, end: true }] },
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
    group: "Negocio",
    items: [
      { to: "/usuarios", label: "Usuarios", icon: Users, permission: "users:read" },
      { to: "/actividad", label: "Actividad", icon: Activity, permission: "audit:read" },
      { to: "/configuracion", label: "Configuración", icon: Settings },
    ],
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
  [/^\/usuarios$/, "Usuarios"],
  [/^\/actividad$/, "Actividad"],
  [/^\/configuracion$/, "Configuración"],
];
const titleFor = (path: string) => TITLES.find(([re]) => re.test(path))?.[1] ?? "";

export function AppLayout() {
  const { me, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [location.pathname]);
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
          const items = section.items.filter((item) => !item.permission || can(item.permission));
          if (!items.length) return null;
          return (
            <nav className="nx-nav" key={i}>
              {section.group && <div className="nx-nav__group">{section.group}</div>}
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="nx-nav__item">
                  <Icon className="nx-icon" aria-hidden="true" />
                  {label}
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
          <div className="nx-row" style={{ gap: 8 }}>
            <Button variant="ghost" size="sm" icon className="nx-mobile-only" aria-label="Abrir menú" onClick={() => setOpen((v) => !v)}>
              <Menu className="nx-icon" aria-hidden="true" />
            </Button>
            <nav className="nx-breadcrumb" aria-label="Ruta">
              <span>{me.tenant.name}</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{titleFor(location.pathname)}</span>
            </nav>
          </div>
          <div className="nx-row" style={{ gap: 12 }}>
            <div style={{ textAlign: "right", lineHeight: "16px" }}>
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
