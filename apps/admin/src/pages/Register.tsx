import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MeResponse } from "@nexo/shared";
import { Alert, Button, SelectField, TextField } from "@nexo/ui";
import { post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSubmit } from "../lib/hooks";
import { CURRENCIES } from "../lib/options";
import { AuthLayout } from "./AuthLayout";

export function RegisterPage() {
  const { setMe, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ businessName: "", ownerName: "", email: "", password: "", currency: "MXN" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { submit, pending, fields, message } = useSubmit(async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const me = await post<MeResponse>("/auth/register", { ...form, timezone });
    setMe(me);
    // The full profile (plan, account status, support access) comes from /me.
    await refresh();
    navigate("/", { replace: true });
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <AuthLayout
      title="Crea tu negocio"
      subtitle="Empieza gratis. Podrás invitar a tu equipo después."
      footer={<>¿Ya tienes cuenta? <Link className="nx-link" to="/ingresar">Inicia sesión</Link></>}
    >
      <form className="nx-stack" onSubmit={onSubmit} noValidate>
        {message && <Alert tone="danger">{message}</Alert>}
        <TextField label="Nombre del negocio" value={form.businessName} onChange={set("businessName")} error={fields.businessName} autoFocus placeholder="Casa Olivo" />
        <TextField label="Tu nombre" autoComplete="name" value={form.ownerName} onChange={set("ownerName")} error={fields.ownerName} />
        <TextField label="Correo" type="email" autoComplete="email" value={form.email} onChange={set("email")} error={fields.email} />
        <TextField label="Contraseña" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} error={fields.password} help="Al menos 10 caracteres." />
        <SelectField label="Moneda" value={form.currency} onChange={set("currency")} error={fields.currency}>
          {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </SelectField>
        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          {pending ? "Creando tu negocio" : "Crear negocio"}
        </Button>
      </form>
    </AuthLayout>
  );
}
