/** Sign in / create account, used on its own page and inside the checkout. */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { StoreAccount } from "@nexo/shared";
import { Alert, Button, Checkbox, TextField } from "@nexo/ui";
import { api, RequestError } from "../lib/api";
import { useAccount } from "../lib/account";
import { useStore } from "../lib/store";

export type AuthMode = "login" | "register";

export function AuthForm({ mode: initial = "login", onDone }: { mode?: AuthMode; onDone?: (a: StoreAccount) => void }) {
  const { slug, link, store } = useStore();
  const { setAccount } = useAccount();
  const [mode, setMode] = useState<AuthMode>(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setFields({});
    setMessage(null);
    try {
      const r = mode === "login"
        ? await api<{ account: StoreAccount }>("POST", `/${slug}/account/login`, { email, password })
        : await api<{ account: StoreAccount }>("POST", `/${slug}/account/register`, { name, email, password, phone: phone || null, acceptsMarketing: marketing });
      setAccount(r.account);
      onDone?.(r.account);
    } catch (err) {
      const x = err as RequestError;
      setFields(x.fields);
      // "Already have an account": offer to sign in with the same email.
      if (x.code === "email_taken") setMessage(x.message);
      else if (!Object.keys(x.fields).length || x.code !== "validation_error") setMessage(x.message);
    } finally {
      setPending(false);
    }
  };
  const swap = (m: AuthMode) => { setMode(m); setFields({}); setMessage(null); };
  const clear1 = (k: string) => setFields((f) => { if (!f[k]) return f; const n = { ...f }; delete n[k]; return n; });

  return (
    <div className="st-auth">
      <div className="st-auth__tabs" role="tablist" aria-label="Cuenta">
        <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => swap("login")}>Ya tengo cuenta</button>
        <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => swap("register")}>Crear cuenta</button>
      </div>
      <form className="nx-stack" onSubmit={submit} noValidate>
        {message && (
          <Alert tone={mode === "register" && fields.email ? "info" : "danger"}>
            {message}
            {mode === "register" && fields.email && <> <button type="button" className="st-linklike" onClick={() => swap("login")}>Iniciar sesión</button></>}
          </Alert>
        )}
        {mode === "register" && <TextField label="Nombre completo" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); clear1("name"); }} error={fields.name} />}
        <TextField label="Correo" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); clear1("email"); }} error={mode === "register" ? fields.email : undefined} />
        {mode === "register" && <TextField label="Teléfono" optional type="tel" autoComplete="tel" value={phone} onChange={(e) => { setPhone(e.target.value); clear1("phone"); }} error={fields.phone} help="Por si necesitamos contactarte sobre un pedido." />}
        <TextField
          label="Contraseña"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => { setPassword(e.target.value); clear1("password"); }}
          error={fields.password}
          help={mode === "register" ? "Mínimo 10 caracteres." : undefined}
        />
        {mode === "login" && <div style={{ marginTop: -6 }}><Link className="st-linklike" to={link("/cuenta/recuperar")}>¿Olvidaste tu contraseña?</Link></div>}
        {mode === "register" && <Checkbox label={`Quiero recibir promociones de ${store?.name ?? "la tienda"}`} checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />}
        <Button type="submit" variant="primary" size="lg" block loading={pending}>{mode === "login" ? "Entrar" : "Crear cuenta"}</Button>
        {mode === "register" && <p className="nx-help" style={{ margin: 0, textAlign: "center" }}>Tu cuenta es solo de {store?.name ?? "esta tienda"}. Con ella ves tus pedidos y compras más rápido.</p>}
      </form>
    </div>
  );
}
