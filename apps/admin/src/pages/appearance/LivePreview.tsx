/**
 * The real store inside the editor. It loads with a short-lived preview token (so it works before the store
 * is on) and receives the unsaved draft by postMessage, only from and to the store's origin.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import type { StoreAppearance } from "@nexo/shared";
import { Alert, Button, Segmented } from "@nexo/ui";
import { post } from "../../lib/api";

type Device = "desktop" | "mobile";
const WIDTH: Record<Device, number> = { desktop: 1280, mobile: 390 };

export function LivePreview({ appearance, storeUrl, selected }: { appearance: StoreAppearance; storeUrl: string; selected: string | null }) {
  const [device, setDevice] = useState<Device>("desktop");
  const [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Counts the store's "ready" messages: each (re)load of the frame gets the draft again.
  const [ready, setReady] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const origin = (() => { try { return new URL(storeUrl).origin; } catch { return null; } })();

  // Token, renewed before it expires.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const get = () =>
      post<{ token: string; expiresAt: string }>("/store-settings/appearance/preview")
        .then((t) => {
          if (!live) return;
          setToken(t);
          setError(null);
          timer = setTimeout(get, Math.max(60_000, new Date(t.expiresAt).getTime() - Date.now() - 5 * 60_000));
        })
        .catch((e: Error) => { if (live) setError(e.message); });
    void get();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  // The store says it is ready (on every load of the frame).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!origin || e.origin !== origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === "nx-preview:ready") setReady((n) => n + 1);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  // Draft and selection: sent as they change (the draft a moment after typing stops).
  useEffect(() => { setReady(0); }, [device, token?.token]);
  useEffect(() => {
    if (!ready || !origin) return;
    const t = setTimeout(() => frame.current?.contentWindow?.postMessage({ type: "nx-preview:appearance", appearance }, origin), 150);
    return () => clearTimeout(t);
  }, [appearance, ready, origin]);
  useEffect(() => {
    if (ready && origin) frame.current?.contentWindow?.postMessage({ type: "nx-preview:select", id: selected }, origin);
  }, [selected, ready, origin]);

  // Fit the store's width into the panel.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ width: entry!.contentRect.width, height: entry!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vw = WIDTH[device];
  const scale = box.width ? Math.min(1, box.width / vw) : 1;
  const src = token && origin ? `${storeUrl}${storeUrl.includes("?") ? "&" : "?"}nx-preview=${encodeURIComponent(token.token)}` : null;

  return (
    <div className="nx-live">
      <div className="nx-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="nx-label">Vista previa en vivo</span>
        <div className="nx-row" style={{ gap: 4 }}>
          <Segmented label="Dispositivo" value={device} onChange={setDevice} options={[{ id: "desktop", label: "Computadora" }, { id: "mobile", label: "Celular" }]} />
          <Button size="sm" variant="ghost" icon aria-label="Recargar la vista previa" title="Recargar" onClick={() => { setReady(0); setNonce((n) => n + 1); }}><RotateCw className="nx-icon" aria-hidden="true" /></Button>
          <a className="nx-btn nx-btn--ghost nx-btn--sm nx-btn--icon" href={storeUrl} target="_blank" rel="noreferrer" aria-label="Abrir la tienda" title="Abrir la tienda"><ExternalLink className="nx-icon" aria-hidden="true" /></a>
        </div>
      </div>
      {error && <Alert tone="danger">No se pudo abrir la vista previa: {error}</Alert>}
      <div ref={wrap} className="nx-live__viewport" data-device={device}>
        {src && (
          <iframe
            key={`${device}-${nonce}-${token?.token}`}
            ref={frame}
            className="nx-live__frame"
            title="Vista previa de la tienda"
            src={src}
            style={{ width: vw, height: box.height ? box.height / scale : 800, transform: `scale(${scale})` }}
          />
        )}
        {!ready && !error && <div className="nx-live__loading"><span className="nx-spinner" aria-label="Cargando la vista previa" /></div>}
      </div>
      <p className="nx-help" style={{ margin: 0 }}>Es tu tienda real con los cambios sin guardar; nadie más los ve hasta que guardes.</p>
    </div>
  );
}
