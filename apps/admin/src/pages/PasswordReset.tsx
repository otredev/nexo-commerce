import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, TextField, useToast } from "@nexo/ui";
import { post } from "../lib/api";
import { useSubmit } from "../lib/hooks";
import { AuthLayout } from "./AuthLayout";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { submit, pending, fields, message } = useSubmit(async () => {
    await post("/auth/password/forgot", { email });
    setSent(true);
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <AuthLayout
      title="Recupera tu contraseña"
      subtitle="Te enviaremos un enlace para elegir una nueva."
      footer={<Link className="nx-link" to="/ingresar">Volver a iniciar sesión</Link>}
    >
      {sent ? (
        <Alert tone="success" title="Revisa tu correo">
          Si {email} tiene una cuenta, recibirás un enlace válido por 60 minutos.
        </Alert>
      ) : (
        <form className="nx-stack" onSubmit={onSubmit} noValidate>
          {message && <Alert tone="danger">{message}</Alert>}
          <TextField label="Correo" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} autoFocus />
          <Button type="submit" variant="primary" size="lg" block loading={pending}>
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const { submit, pending, fields, message } = useSubmit(async () => {
    await post("/auth/password/reset", { token: params.get("token") ?? "", password });
    toast("Contraseña actualizada. Inicia sesión.");
    navigate("/ingresar", { replace: true });
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setMismatch(true);
    setMismatch(false);
    void submit();
  };

  return (
    <AuthLayout title="Elige una nueva contraseña" footer={<Link className="nx-link" to="/recuperar">Solicitar otro enlace</Link>}>
      <form className="nx-stack" onSubmit={onSubmit} noValidate>
        {(message || fields.token) && <Alert tone="danger">{message ?? "El enlace no es válido o ya venció. Solicita uno nuevo."}</Alert>}
        <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} help="Al menos 10 caracteres." autoFocus />
        <TextField label="Confirma la contraseña" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? "Las contraseñas no coinciden" : undefined} />
        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          Guardar contraseña
        </Button>
      </form>
    </AuthLayout>
  );
}
