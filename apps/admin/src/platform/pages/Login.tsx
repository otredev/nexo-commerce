import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, TextField } from "@nexo/ui";
import { post } from "../../lib/api";
import { useSubmit } from "../../lib/hooks";
import { useOperator } from "../auth";

export function LoginPage() {
  const { me, ready, refresh } = useOperator();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, pending, fields, message } = useSubmit(async () => {
    await post("/platform/auth/login", { email, password });
    await refresh();
    navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
  });
  if (ready && me) return <Navigate to="/" replace />;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };
  return (
    <div className="nx-auth">
      <div className="nx-auth__box">
        <div className="nx-auth__brand">
          <span className="nx-brand-dot nx-brand-dot--admin" aria-hidden="true" />
          Nexo <span className="nx-admin-tag">Administración</span>
        </div>
        <div className="nx-card">
          <div className="nx-card__header" style={{ flexDirection: "column", gap: 2 }}>
            <h1 className="nx-modal__title">Panel de la plataforma</h1>
            <p className="nx-card__desc">Solo para el equipo que opera Nexo. Los negocios entran en el panel normal.</p>
          </div>
          <div className="nx-card__body">
            <form className="nx-stack" onSubmit={onSubmit} noValidate>
              {message && <Alert tone="danger">{message}</Alert>}
              <TextField label="Correo" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} autoFocus />
              <TextField label="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
              <Button type="submit" variant="primary" size="lg" block loading={pending}>{pending ? "Ingresando" : "Ingresar"}</Button>
            </form>
          </div>
        </div>
        <div className="nx-auth__footer">¿Olvidaste tu contraseña? Pide a otro operador que la cambie, o usa <code>scripts/crear-operador.mjs</code>.</div>
      </div>
    </div>
  );
}
