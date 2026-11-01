import { useState } from "react";
import { PauseCircle, RefreshCw } from "lucide-react";
import { Alert, Button } from "@nexo/ui";
import { post } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Shown instead of the app while the business is suspended or being moved to another database. */
export function BlockedScreen() {
  const { me, refresh, logout, can } = useAuth();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!me) return null;
  const migrating = me.tenant.status === "migrating";
  const openPortal = async () => {
    setPending(true);
    setMessage(null);
    try {
      const res = await post<{ url: string }>("/billing/portal");
      window.location.assign(res.url);
    } catch (e) {
      setMessage((e as Error).message);
      setPending(false);
    }
  };
  return (
    <main className="nx-blocked">
      <div className="nx-blocked__box">
        {migrating ? <RefreshCw className="nx-icon" style={{ width: 32, height: 32, color: "var(--ink-muted)" }} aria-hidden="true" /> : <PauseCircle className="nx-icon" style={{ width: 32, height: 32, color: "var(--ink-muted)" }} aria-hidden="true" />}
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{migrating ? "Estamos moviendo tus datos" : `${me.tenant.name} está suspendida`}</h1>
        <p className="nx-muted" style={{ margin: 0 }}>
          {migrating
            ? "Tarda poco. Tu información está a salvo; vuelve a intentarlo en un minuto."
            : me.tenant.suspendedReason
              ? `Motivo: ${me.tenant.suspendedReason}`
              : "El panel y la tienda en línea están en pausa. Tu información sigue guardada."}
        </p>
        {!migrating && <p className="nx-muted" style={{ margin: 0, fontSize: 13 }}>Si es por un pago pendiente, actualiza tu forma de pago. Para cualquier otra duda escríbenos a soporte.</p>}
        {message && <Alert tone="danger">{message}</Alert>}
        <div className="nx-row" style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {migrating ? <Button variant="primary" onClick={() => void refresh()}>Reintentar</Button> : can("billing:write") && <Button variant="primary" loading={pending} onClick={() => void openPortal()}>Actualizar forma de pago</Button>}
          <Button variant="ghost" onClick={() => void logout()}>Cerrar sesión</Button>
        </div>
      </div>
    </main>
  );
}
