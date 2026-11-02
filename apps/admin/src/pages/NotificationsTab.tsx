/** Settings → Notificaciones: push on this device, which events, devices and a test (Phase 8). */
import { useEffect, useState } from "react";
import { BellOff, BellRing, Send, Smartphone, Trash2 } from "lucide-react";
import type { NotificationSettings } from "@nexo/shared";
import { Alert, Badge, Button, Card, EmptyState, Switch, useToast } from "@nexo/ui";
import { del, get, post, put, RequestError } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from "../lib/pwa";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "Nunca");

export function NotificationsTab() {
  const toast = useToast();
  const load = useLoad(() => get<NotificationSettings>("/notifications"));
  const [here, setHere] = useState<"unknown" | "on" | "off">("unknown");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = pushSupported();
  const permission = supported ? Notification.permission : "default";

  useEffect(() => {
    void currentSubscription().then((s) => setHere(s ? "on" : "off")).catch(() => setHere("off"));
  }, [load.data]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      setError(e instanceof RequestError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const s = load.data;
  if (load.error) return <Alert tone="danger">{load.error.message}</Alert>;
  if (!s) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;

  const toggle = (id: string, enabled: boolean) =>
    run(`pref-${id}`, async () => {
      const prefs = Object.fromEntries(s.events.map((e) => [e.id, e.id === id ? enabled : e.enabled]));
      await put("/notifications/prefs", { prefs });
      load.setData({ ...s, events: s.events.map((e) => (e.id === id ? { ...e, enabled } : e)) });
    });

  const iosNeedsInstall = supported === false && isIos() && !isStandalone();

  return (
    <div className="nx-stack" style={{ maxWidth: 720 }}>
      {!s.available && <Alert tone="info" title="Aún no disponible">La plataforma todavía no tiene configuradas las notificaciones push. Mientras tanto sigues recibiendo los avisos por correo.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <Card
        title="Este dispositivo"
        description="Recibe avisos aunque el panel esté cerrado: en la computadora, el celular o la tablet."
        actions={here === "on" ? <Badge tone="success">Activadas</Badge> : <Badge>Desactivadas</Badge>}
        footer={
          s.available && supported ? (
            <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {here === "on" ? (
                <>
                  <Button loading={busy === "test"} onClick={() => void run("test", () => post("/notifications/test"), "Enviamos una notificación de prueba.")}><Send className="nx-icon" aria-hidden="true" />Enviar prueba</Button>
                  <Button variant="ghost" loading={busy === "off"} onClick={() => void run("off", async () => { await disablePush(); setHere("off"); await load.reload(); }, "Notificaciones desactivadas en este dispositivo.")}><BellOff className="nx-icon" aria-hidden="true" />Desactivar aquí</Button>
                </>
              ) : (
                <Button variant="primary" loading={busy === "on"} disabled={permission === "denied"} onClick={() => void run("on", async () => { await enablePush(s); setHere("on"); await load.reload(); }, "Listo: este dispositivo recibirá notificaciones.")}><BellRing className="nx-icon" aria-hidden="true" />Activar en este dispositivo</Button>
              )}
            </div>
          ) : undefined
        }
      >
        {iosNeedsInstall ? (
          <Alert tone="info" title="En iPhone o iPad">Primero agrega el panel a tu pantalla de inicio: en Safari toca <strong>Compartir → Agregar a inicio</strong>, ábrelo desde ese ícono y vuelve aquí (requiere iOS 16.4 o posterior).</Alert>
        ) : !supported ? (
          <p className="nx-muted">Este navegador no admite notificaciones push. Prueba con Chrome, Edge, Firefox o Safari actualizados.</p>
        ) : permission === "denied" ? (
          <Alert tone="warning">El navegador tiene bloqueadas las notificaciones de este sitio. Ábrelas desde el candado de la barra de direcciones → Notificaciones → Permitir, y recarga la página.</Alert>
        ) : (
          <p className="nx-muted">{here === "on" ? "Este navegador está suscrito. Si cambias de navegador o borras sus datos, tendrás que activarlas otra vez." : "Al activarlas, el navegador te pedirá permiso para mostrar notificaciones."}</p>
        )}
      </Card>

      <Card title="Qué quieres que te avisemos" description="Aplica a todos tus dispositivos. Solo ves los avisos que tu rol permite.">
        <div className="nx-stack">
          {s.events.map((e) => (
            <div key={e.id}>
              <Switch label={e.label} checked={e.enabled} disabled={busy === `pref-${e.id}`} onChange={(v) => void toggle(e.id, v)} />
              <div className="nx-muted" style={{ fontSize: 13, marginTop: 2, paddingLeft: 46 }}>{e.help}</div>
            </div>
          ))}
          {s.events.length === 0 && <p className="nx-muted">Tu rol no recibe notificaciones.</p>}
        </div>
      </Card>

      <Card title="Tus dispositivos" description="Donde tienes activadas las notificaciones de este negocio.">
        {s.devices.length === 0 ? (
          <EmptyState icon={<Smartphone className="nx-icon" />} title="Ningún dispositivo" text="Activa las notificaciones en este dispositivo para empezar." />
        ) : (
          <ul className="nx-list-plain nx-stack">
            {s.devices.map((d) => (
              <li key={d.id} className="nx-row" style={{ justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{d.device ?? "Dispositivo"}</div>
                  <div className="nx-muted" style={{ fontSize: 13 }}>Desde {when(d.createdAt)} · último aviso: {when(d.lastSentAt)}</div>
                </div>
                <Button variant="ghost" size="sm" aria-label={`Quitar ${d.device ?? "dispositivo"}`} loading={busy === `del-${d.id}`} onClick={() => void run(`del-${d.id}`, async () => { await del(`/notifications/subscriptions/${d.id}`); await load.reload(); }, "Dispositivo quitado.")}><Trash2 className="nx-icon" aria-hidden="true" />Quitar</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
