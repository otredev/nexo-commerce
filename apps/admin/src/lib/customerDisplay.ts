/**
 * Customer display (Phase 8): the register publishes what the customer should see.
 * - Same computer (second monitor): BroadcastChannel, no server involved.
 * - Another device (tablet, TV): the state goes to /api/pos/display/:code and from there over a WebSocket.
 * The display answers only one thing: the customer's optional sign-up. Same computer: over the channel;
 * another device: it waits in the hub's inbox, which the register polls while it is asking.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { displaySignupMessageSchema, type DisplayDevice, type DisplaySignupMessage, type DisplayState } from "@nexo/shared";
import { del, get, post, RequestError } from "./api";

/** A display on this computer says "here" every few seconds; after this long without hearing it, it's gone. */
const LOCAL_TTL = 15_000;

export const displayChannelName = (tenantId: string, locationId: string) => `nx-display:${tenantId}:${locationId}`;
const codeKey = (tenantId: string, locationId: string) => `nx.pos.display.${tenantId}.${locationId}`;

const readCode = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

/** Publishes the display state; remembers the pairing code of this register. */
export function useDisplayPublisher(tenantId: string, locationId: string) {
  const channel = useRef<BroadcastChannel | null>(null);
  const last = useRef<DisplayState | null>(null);
  const key = codeKey(tenantId, locationId);
  const [code, setCodeState] = useState<string | null>(() => readCode(key));
  /** Paired devices, and what the display app says it can do (Tap to Pay). */
  const [remote, setRemote] = useState<{ displays: number; error: string | null; device: DisplayDevice | null }>({ displays: 0, error: null, device: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localSeen, setLocalSeen] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const onMessage = useRef<((m: DisplaySignupMessage) => void) | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(displayChannelName(tenantId, locationId));
    channel.current = ch;
    ch.onmessage = (e) => {
      // A display that opens late asks for the current state; open displays say "here" now and then.
      if (e.data === "hello" || e.data === "here") {
        setLocalSeen(Date.now());
        if (e.data === "hello" && last.current) ch.postMessage(last.current);
        return;
      }
      if (e.data && typeof e.data === "object" && "type" in e.data) {
        const r = displaySignupMessageSchema.safeParse(e.data);
        if (r.success) onMessage.current?.(r.data);
      }
    };
    return () => { ch.close(); channel.current = null; };
  }, [tenantId, locationId]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(t); }, []);

  const setCode = (c: string | null) => {
    try { if (c) localStorage.setItem(key, c); else localStorage.removeItem(key); } catch { /* private mode */ }
    setCodeState(c);
  };

  const sendRemote = useCallback(async (c: string, state: DisplayState) => {
    try {
      const r = await post<{ displays: number; device: DisplayDevice | null }>(`/pos/display/${c}/state`, { state });
      setRemote({ displays: r.displays, error: null, device: r.device ?? null });
    } catch (e) {
      const err = e as RequestError;
      if (err.code === "display_gone") setCode(null);
      setRemote({ displays: 0, error: err.message, device: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publish = useCallback((state: DisplayState) => {
    last.current = state;
    channel.current?.postMessage(state);
    if (!code) return;
    // Scanning fast sends at most ~4 updates per second; the last one always goes.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void sendRemote(code, state), 250);
  }, [code, sendRemote]);

  const pair = async () => {
    const r = await post<{ code: string }>("/pos/display", { locationId });
    setCode(r.code);
    if (last.current) void sendRemote(r.code, last.current);
    return r.code;
  };
  const unpair = async () => {
    if (code) await del(`/pos/display/${code}`).catch(() => {});
    setCode(null);
    setRemote({ displays: 0, error: null, device: null });
  };

  /** What the customer did on another device, oldest first (picked up once). */
  const pollInbox = useCallback(async (): Promise<DisplaySignupMessage[]> => {
    if (!code) return [];
    const raw = await get<unknown>(`/pos/display/${code}/inbox`).catch(() => null);
    return (Array.isArray(raw) ? raw : []).flatMap((m) => { const r = displaySignupMessageSchema.safeParse(m); return r.success ? [r.data] : []; });
  }, [code]);

  /** Is someone looking? A display open on this computer, or one connected with the code. */
  const active = now - localSeen < LOCAL_TTL || remote.displays > 0;

  /** The paired display can take cards now (display app with Tap to Pay, reader ready). */
  const cardReady = Boolean(code && remote.displays > 0 && remote.device?.tapToPay && remote.device.ready);

  return { publish, code, pair, unpair, remote, active, onMessage, pollInbox, cardReady };
}
