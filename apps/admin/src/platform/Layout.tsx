import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Building2, Gauge, KeyRound, LifeBuoy, LogOut, Menu, ScrollText, ShieldCheck, Users } from "lucide-react";
import { Alert, Avatar, Button, Modal, TextField, useToast } from "@nexo/ui";
import { post } from "../lib/api";
import { useSubmit } from "../lib/hooks";
import { useOperator } from "./auth";

const NAV = [
  { to: "/", label: "Inicio", icon: Gauge, end: true },
  { to: "/negocios", label: "Negocios", icon: Building2 },
  { to: "/usuarios", label: "Usuarios", icon: Users },
  { to: "/soporte", label: "Soporte", icon: LifeBuoy, badge: true },
  { to: "/bitacora", label: "Bitácora", icon: ScrollText },
  { to: "/operadores", label: "Operadores", icon: ShieldCheck },
];

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Inicio"],
  [/^\/negocios\/.+/, "Negocio"],
  [/^\/negocios$/, "Negocios"],
  [/^\/usuarios\/.+/, "Usuario"],
  [/^\/usuarios$/, "Usuarios"],
  [/^\/soporte\/.+/, "Ticket"],
  [/^\/soporte$/, "Soporte"],
  [/^\/bitacora$/, "Bitácora"],
  [/^\/operadores$/, "Operadores"],
];

export function PlatformLayout() {
  const { me, logout, refresh } = useOperator();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  // The support badge follows the queue: refreshed on every page and every minute.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => { void refresh(); }, [location.pathname, refresh]);
  useEffect(() => {
    const title = TITLES.find(([re]) => re.test(location.pathname))?.[1];
    document.title = `${title ? `${title} · ` : ""}Nexo Administración`;
  }, [location.pathname]);
  if (!me) return null;
  const title = TITLES.find(([re]) => re.test(location.pathname))?.[1] ?? "";

  return (
    <div className="nx-shell nx-shell--admin">
      {open && <div className="nx-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className="nx-sidebar" data-open={open} aria-label="Navegación de administración">
        <a className="nx-brand" href="/admin/">
          <span className="nx-brand-dot nx-brand-dot--admin" aria-hidden="true" />
          Nexo <span className="nx-admin-tag">Admin</span>
        </a>
        <nav className="nx-nav" aria-label="Principal">
          <div className="nx-nav__list">
            {NAV.map(({ to, label, icon: Icon, end, badge }) => (
              <NavLink key={to} to={to} end={end} className="nx-nav__item">
                <Icon className="nx-icon" aria-hidden="true" />
                {label}
                {badge && me.openTickets > 0 && <span className="nx-nav__badge" aria-label={`${me.openTickets} tickets por responder`}>{me.openTickets}</span>}
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="nx-sidebar__footer nx-nav">
          <button type="button" className="nx-nav__item nx-nav__button" onClick={() => setAccount(true)}>
            <KeyRound className="nx-icon" aria-hidden="true" />
            Mi contraseña
          </button>
          <button type="button" className="nx-nav__item nx-nav__button" onClick={async () => { await logout(); navigate("/ingresar"); }}>
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
              <span>Administración</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{title}</span>
            </nav>
          </div>
          <div className="nx-topbar__right">
            <div className="nx-topbar__who">
              <div style={{ fontSize: 13, fontWeight: 500 }}>{me.operator.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>Operador</div>
            </div>
            <Avatar name={me.operator.name} />
          </div>
        </header>
        <main className="nx-content">
          <Outlet />
        </main>
      </div>
      <PasswordModal open={account} onClose={() => setAccount(false)} />
    </div>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = useSubmit(async () => {
    await post("/platform/auth/password", { currentPassword: current, newPassword: next });
    toast("Contraseña cambiada. Las demás sesiones se cerraron.");
    setCurrent("");
    setNext("");
    onClose();
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save.submit();
  };
  return (
    <Modal
      open={open}
      title="Cambiar mi contraseña"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="op-password" loading={save.pending}>Guardar</Button></>}
    >
      <form id="op-password" className="nx-stack" onSubmit={onSubmit} noValidate>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <TextField label="Contraseña actual" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={save.fields.currentPassword} />
        <TextField label="Contraseña nueva" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={save.fields.newPassword} help="Mínimo 10 caracteres." />
      </form>
    </Modal>
  );
}
