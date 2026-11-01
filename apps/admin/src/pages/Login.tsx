import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { MeResponse } from "@nexo/shared";
import { Alert, Button, TextField } from "@nexo/ui";
import { post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSubmit } from "../lib/hooks";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const { setMe, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, pending, fields, message } = useSubmit(async () => {
    const me = await post<MeResponse>("/auth/login", { email, password });
    setMe(me);
    // The full profile (plan, account status, platform access) comes from /me.
    await refresh();
    navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <AuthLayout
      title="Inicia sesión"
      subtitle="Administra tu negocio desde cualquier lugar."
      footer={<>¿Aún no tienes cuenta? <Link className="nx-link" to="/registro">Crea tu negocio</Link></>}
    >
      <form className="nx-stack" onSubmit={onSubmit} noValidate>
        {message && <Alert tone="danger">{message}</Alert>}
        <TextField label="Correo" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} autoFocus />
        <TextField label="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
        <div style={{ textAlign: "right", marginTop: -8 }}>
          <Link className="nx-link" style={{ fontSize: 13 }} to="/recuperar">¿Olvidaste tu contraseña?</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          {pending ? "Ingresando" : "Ingresar"}
        </Button>
      </form>
    </AuthLayout>
  );
}
