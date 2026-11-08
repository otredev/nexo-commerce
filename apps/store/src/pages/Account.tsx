/** Customer account pages: sign in / up, "Mi cuenta" (orders, details, password) and password recovery. */
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { customerStatusLabel, FULFILLMENT_LABELS, type StoreAccount, type StoreAccountOrder } from "@nexo/shared";
import { Alert, Button, Checkbox, TextAreaField, TextField, useToast } from "@nexo/ui";
import { AuthForm, type AuthMode } from "../components/AuthForm";
import { firstName, useAccount } from "../lib/account";
import { api, RequestError } from "../lib/api";
import { useStore } from "../lib/store";

const dateFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
const label = (n: number) => `#${String(n).padStart(6, "0")}`;

/** Only paths inside this store, so ?siguiente= can never send the customer to another site. */
const safeNext = (next: string | null, link: (p?: string) => string) => (next && /^\/(?!\/)[\w\-/]*$/.test(next) ? link(next) : link("/cuenta"));

export function AuthPage() {
  const { link, store } = useStore();
  const { account, ready } = useAccount();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("siguiente"), link);
  useEffect(() => { if (store) document.title = `Entrar · ${store.name}`; }, [store]);
  if (ready && account) return <Navigate to={next} replace />;
  return (
    <div className="st-wrap st-account-auth">
      <h1 className="st-page-title">Tu cuenta</h1>
      <AuthForm mode={(params.get("modo") as AuthMode) === "register" ? "register" : "login"} onDone={() => navigate(next, { replace: true })} />
    </div>
  );
}

export function AccountPage() {
  const { slug, link, store, money } = useStore();
  const { account, ready, setAccount, logout } = useAccount();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<StoreAccountOrder[] | null>(null);
  const [tab, setTab] = useState<"orders" | "details" | "password">("orders");
  useEffect(() => { if (store) document.title = `Mi cuenta · ${store.name}`; }, [store]);
  useEffect(() => {
    if (!account) return;
    api<{ items: StoreAccountOrder[] }>("GET", `/${slug}/account/orders`).then((r) => setOrders(r.items), () => setOrders([]));
  }, [slug, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <div className="nx-page-loading" style={{ minHeight: "40vh" }}><span className="nx-spinner" aria-label="Cargando" /></div>;
  if (!account) return <Navigate to={link("/entrar?siguiente=/cuenta")} replace />;

  return (
    <div className="st-wrap st-account">
      <div className="st-account__head">
        <div>
          <h1 className="st-page-title" style={{ marginBottom: 4 }}>Hola, {firstName(account.name)}</h1>
          <p className="st-muted" style={{ margin: 0 }}>{account.email}</p>
        </div>
        <Button onClick={async () => { await logout(); navigate(link(), { replace: true }); }}>Cerrar sesión</Button>
      </div>
      <div className="st-auth__tabs st-account__tabs" role="tablist" aria-label="Mi cuenta">
        <button type="button" role="tab" aria-selected={tab === "orders"} onClick={() => setTab("orders")}>Mis pedidos</button>
        <button type="button" role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>Mis datos</button>
        <button type="button" role="tab" aria-selected={tab === "password"} onClick={() => setTab("password")}>Contraseña</button>
      </div>
      {tab === "orders" && (
        orders === null ? <div className="nx-page-loading" style={{ minHeight: 160 }}><span className="nx-spinner" aria-label="Cargando" /></div>
        : orders.length === 0 ? (
          <div className="st-empty" style={{ padding: "40px 0" }}>
            <p className="st-empty__text">Aún no tienes pedidos con esta cuenta.</p>
            <Link className="nx-btn nx-btn--primary" to={link()}>Ver productos</Link>
          </div>
        ) : (
          <ul className="st-orders">
            {orders.map((o) => (
              <li key={o.token}>
                <Link to={link(`/pedido/${o.token}`)} className="st-orders__row">
                  <span>
                    <span className="st-orders__num">Pedido {label(o.number)}</span>
                    <span className="st-muted">{dateFmt.format(new Date(o.createdAt))} · {o.items} {o.items === 1 ? "producto" : "productos"} · {FULFILLMENT_LABELS[o.fulfillment]}</span>
                  </span>
                  <span className="st-orders__side">
                    <span className="st-orders__status" data-status={o.status}>{customerStatusLabel(o.status, o.fulfillment)}</span>
                    <span className="nx-num">{money(o.totalCents)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
      {tab === "details" && <DetailsForm account={account} onSaved={setAccount} />}
      {tab === "password" && <PasswordForm />}
    </div>
  );
}

function DetailsForm({ account, onSaved }: { account: StoreAccount; onSaved: (a: StoreAccount) => void }) {
  const { slug } = useStore();
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone ?? "");
  const [address, setAddress] = useState(account.address ?? "");
  const [marketing, setMarketing] = useState(account.acceptsMarketing);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setFields({});
    try {
      const r = await api<{ account: StoreAccount }>("PUT", `/${slug}/account`, { name, phone: phone || null, address: address || null, acceptsMarketing: marketing });
      onSaved(r.account);
      toast("Guardamos tus datos");
    } catch (err) {
      setFields((err as RequestError).fields);
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="nx-stack st-account__form" onSubmit={submit} noValidate>
      <TextField label="Nombre completo" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
      <TextField label="Correo" value={account.email} disabled help="Es con el que entras. No se puede cambiar." />
      <TextField label="Teléfono" optional type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={fields.phone} />
      <TextAreaField label="Dirección de entrega" optional rows={3} autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} error={fields.address} help="La proponemos al pagar si eliges envío a domicilio." />
      <Checkbox label="Quiero recibir promociones" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
      <div><Button type="submit" variant="primary" loading={pending}>Guardar</Button></div>
    </form>
  );
}

function PasswordForm() {
  const { slug } = useStore();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setFields({});
    try {
      await api("POST", `/${slug}/account/password`, { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      toast("Contraseña cambiada. Cerramos tu sesión en otros dispositivos.");
    } catch (err) {
      setFields((err as RequestError).fields);
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="nx-stack st-account__form" onSubmit={submit} noValidate>
      <TextField label="Contraseña actual" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={fields.currentPassword} />
      <TextField label="Contraseña nueva" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={fields.newPassword} help="Mínimo 10 caracteres." />
      <div><Button type="submit" variant="primary" loading={pending}>Cambiar contraseña</Button></div>
    </form>
  );
}

export function ForgotPage() {
  const { slug, link, store } = useStore();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { if (store) document.title = `Recuperar contraseña · ${store.name}`; }, [store]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await api("POST", `/${slug}/account/forgot`, { email });
      setSent(true);
    } catch (err) {
      setMessage((err as RequestError).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="st-wrap st-account-auth">
      <h1 className="st-page-title">Recupera tu contraseña</h1>
      {sent ? (
        <div className="nx-stack">
          <Alert tone="success" title="Revisa tu correo">Si {email} tiene una cuenta en {store?.name ?? "la tienda"}, te enviamos un enlace para elegir una contraseña nueva. Vence en una hora.</Alert>
          <Link className="st-linklike" to={link("/entrar")}>Volver a entrar</Link>
        </div>
      ) : (
        <form className="nx-stack" onSubmit={submit} noValidate>
          <p className="st-muted" style={{ margin: 0 }}>Escribe el correo de tu cuenta y te enviamos un enlace.</p>
          {message && <Alert tone="danger">{message}</Alert>}
          <TextField label="Correo" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="primary" size="lg" block loading={pending} disabled={!email.trim()}>Enviar enlace</Button>
          <Link className="st-linklike" to={link("/entrar")}>Volver a entrar</Link>
        </form>
      )}
    </div>
  );
}

export function ResetPage() {
  const { slug, link } = useStore();
  const { setAccount } = useAccount();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setFields({});
    setMessage(null);
    try {
      const r = await api<{ account: StoreAccount }>("POST", `/${slug}/account/reset`, { token, password });
      setAccount(r.account);
      navigate(link("/cuenta"), { replace: true });
    } catch (err) {
      const x = err as RequestError;
      setFields(x.fields);
      if (!x.fields.password) setMessage(x.message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="st-wrap st-account-auth">
      <h1 className="st-page-title">Elige una contraseña nueva</h1>
      <form className="nx-stack" onSubmit={submit} noValidate>
        {(message || !token) && (
          <Alert tone="danger">
            {message ?? "Falta el enlace del correo."} <Link className="st-linklike" to={link("/cuenta/recuperar")}>Pedir otro enlace</Link>
          </Alert>
        )}
        <TextField label="Contraseña nueva" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} help="Mínimo 10 caracteres." />
        <Button type="submit" variant="primary" size="lg" block loading={pending} disabled={!token}>Guardar y entrar</Button>
      </form>
    </div>
  );
}
