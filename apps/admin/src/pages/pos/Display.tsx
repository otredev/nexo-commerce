/**
 * Customer display (Phase 8): what the customer sees while the cashier sells.
 * /pos/cliente → second monitor of the same computer (BroadcastChannel).
 * /pantalla    → any device (tablet, TV) paired with a 6-digit code, no sign-in (WebSocket).
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Maximize2 } from "lucide-react";
import { formatMoney, type DisplayState } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { useAuth } from "../../lib/auth";
import { displayChannelName } from "../../lib/customerDisplay";

/** Keeps the screen on while the display is open (tablets). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const request = () => nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    void request();
    const onVisible = () => { if (document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); void lock?.release().catch(() => {}); };
  }, []);
}

export function CustomerDisplayView({ state, status }: { state: DisplayState | null; status?: string | null }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [state?.lines.length, state?.at]);
  if (!state) {
    return (
      <div className="nx-cd nx-cd--center">
        <span className="nx-spinner" aria-hidden="true" />
        <p className="nx-cd__hint">{status ?? "Esperando a la caja…"}</p>
      </div>
    );
  }
  const money = (c: number) => formatMoney(c, state.currency, state.locale);
  const logo = state.business.logoKey ? <img className="nx-cd__logo" src={`/files/${state.business.logoKey}`} alt="" /> : null;

  if (state.phase === "idle" || (state.phase === "cart" && state.lines.length === 0)) {
    return (
      <div className="nx-cd nx-cd--center">
        {logo}
        <h1 className="nx-cd__welcome">{state.business.name}</h1>
        <p className="nx-cd__hint">¡Bienvenido!</p>
        {status && <p className="nx-cd__status">{status}</p>}
      </div>
    );
  }
  if (state.phase === "paid") {
    return (
      <div className="nx-cd nx-cd--center nx-cd--paid">
        {logo}
        <h1 className="nx-cd__welcome">¡Gracias por tu compra!</h1>
        <div className="nx-cd__paid">
          <div><span>Total</span><strong className="nx-num">{money(state.totalCents)}</strong></div>
          {state.changeCents > 0 && <div className="nx-cd__change"><span>Tu cambio</span><strong className="nx-num">{money(state.changeCents)}</strong></div>}
        </div>
        {state.saleNumber && <p className="nx-cd__hint">Venta #{String(state.saleNumber).padStart(6, "0")}</p>}
      </div>
    );
  }
  return (
    <div className="nx-cd">
      <section className="nx-cd__items" aria-label="Tu compra">
        <header className="nx-cd__head">
          {logo}
          <span>{state.business.name}</span>
          {state.customerName && <span className="nx-cd__customer">{state.customerName}</span>}
        </header>
        <ol className="nx-cd__list" ref={listRef}>
          {state.lines.map((l, i) => (
            <li key={l.key} className="nx-cd__line" data-last={i === state.lines.length - 1}>
              <div>
                <div className="nx-cd__name">{l.name}</div>
                <div className="nx-cd__detail">{l.quantity}{l.detail && ` · ${l.detail}`}</div>
                {l.savingCents > 0 && <div className="nx-cd__saving">Ahorras {money(l.savingCents)}</div>}
              </div>
              <div className="nx-num nx-cd__amount">{money(l.totalCents)}</div>
            </li>
          ))}
        </ol>
      </section>
      <aside className="nx-cd__totals" aria-label="Total">
        <dl>
          <div><dt>Productos</dt><dd className="nx-num">{state.itemsCount}</dd></div>
          {state.discountCents > 0 && <div className="nx-cd__save"><dt>Descuentos</dt><dd className="nx-num">−{money(state.discountCents)}</dd></div>}
          <div><dt>{state.pricesIncludeTax ? "IVA incluido" : "Impuestos"}</dt><dd className="nx-num">{money(state.taxCents)}</dd></div>
        </dl>
        <div className="nx-cd__total"><span>Total</span><strong className="nx-num">{money(state.totalCents)}</strong></div>
        {state.phase === "paying" && (
          <div className="nx-cd__pay">
            <div><span>Recibido</span><strong className="nx-num">{money(state.paidCents)}</strong></div>
            {state.changeCents > 0 && <div className="nx-cd__change"><span>Tu cambio</span><strong className="nx-num">{money(state.changeCents)}</strong></div>}
          </div>
        )}
      </aside>
    </div>
  );
}

function FullscreenButton() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = () => setHidden(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  if (hidden || !document.documentElement.requestFullscreen) return null;
  return (
    <button type="button" className="nx-cd__fs" onClick={() => void document.documentElement.requestFullscreen().catch(() => {})} aria-label="Pantalla completa">
      <Maximize2 className="nx-icon" aria-hidden="true" />
    </button>
  );
}

/** Second monitor of the register's computer: /pos/cliente?ubicacion=<id>. */
export function LocalDisplayPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const [state, setState] = useState<DisplayState | null>(null);
  const locationId = params.get("ubicacion") ?? "";
  useWakeLock();
  useEffect(() => {
    document.title = "Pantalla del cliente";
    if (!me || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(displayChannelName(me.tenant.id, locationId));
    ch.onmessage = (e) => { if (e.data && typeof e.data === "object") setState(e.data as DisplayState); };
    ch.postMessage("hello");
    return () => ch.close();
  }, [me, locationId]);
  return <><CustomerDisplayView state={state} status="Abre una venta en la caja de esta computadora." /><FullscreenButton /></>;
}

const SAVED_CODE = "nx.display.code";

/** Tablet or TV paired with a code: /pantalla. */
export function PairedDisplayPage() {
  const [code, setCode] = useState<string | null>(() => { try { return localStorage.getItem(SAVED_CODE); } catch { return null; } });
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DisplayState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useWakeLock();
  useEffect(() => { document.title = "Pantalla del cliente"; }, []);

  useEffect(() => {
    if (!code) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let ping: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const forget = (message: string) => {
      try { localStorage.removeItem(SAVED_CODE); } catch { /* ignore */ }
      setCode(null);
      setState(null);
      setError(message);
    };
    const connect = async () => {
      // Validates the code first (a WebSocket cannot tell a wrong code from a network error).
      const res = await fetch(`/api/display/${code}`, { cache: "no-store" }).catch(() => null);
      if (closed) return;
      if (res?.status === 404) return forget("Ese código ya no es válido. Pide uno nuevo en la caja.");
      if (res?.ok) { const s = (await res.json().catch(() => null)) as DisplayState | null; if (s) setState(s); }
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/api/display/${code}/ws`);
      ws.onopen = () => { retry = 0; setStatus(null); ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25_000); };
      ws.onmessage = (e) => { if (e.data !== "pong") { try { setState(JSON.parse(e.data as string) as DisplayState); } catch { /* ignore */ } } };
      ws.onclose = (e) => {
        clearInterval(ping);
        if (closed) return;
        if (e.code === 4000) return forget("La caja terminó el emparejamiento.");
        setStatus("Reconectando…");
        timer = setTimeout(() => void connect(), Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    void connect();
    return () => { closed = true; clearInterval(ping); clearTimeout(timer); ws?.close(); };
  }, [code]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = input.replace(/\D/g, "");
    if (c.length !== 6) return setError("El código tiene 6 dígitos.");
    try { localStorage.setItem(SAVED_CODE, c); } catch { /* ignore */ }
    setError(null);
    setCode(c);
  };

  if (!code) {
    return (
      <div className="nx-cd nx-cd--center">
        <form className="nx-cd__pair" onSubmit={submit}>
          <h1 className="nx-cd__welcome" style={{ fontSize: 32 }}>Pantalla del cliente</h1>
          <p className="nx-cd__hint">En la caja, elige <strong>Pantalla del cliente → Conectar otro dispositivo</strong> y escribe aquí el código.</p>
          <input className="nx-cd__code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Código de 6 dígitos" placeholder="000000" autoFocus />
          {error && <p className="nx-cd__error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" size="lg">Conectar</Button>
        </form>
      </div>
    );
  }
  return (
    <>
      <CustomerDisplayView state={state} status={status ?? "Conectado. Esperando la siguiente venta."} />
      <FullscreenButton />
      <button type="button" className="nx-cd__unpair" onClick={() => { try { localStorage.removeItem(SAVED_CODE); } catch { /* ignore */ } setCode(null); setState(null); }}>Desconectar</button>
    </>
  );
}
