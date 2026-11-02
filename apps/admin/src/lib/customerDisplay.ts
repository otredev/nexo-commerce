/**
 * Customer display (Phase 8): the register publishes what the customer should see.
 * - Same computer (second monitor): BroadcastChannel, no server involved.
 * - Another device (tablet, TV): the state goes to /api/pos/display/:code and from there over a WebSocket.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DisplayState } from "@nexo/shared";
import { del, post, RequestError } from "./api";

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
  const [remote, setRemote] = useState<{ displays: number; error: string | null }>({ displays: 0, error: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(displayChannelName(tenantId, locationId));
    channel.current = ch;
    // A display that opens late asks for the current state.
    ch.onmessage = (e) => { if (e.data === "hello" && last.current) ch.postMessage(last.current); };
    return () => { ch.close(); channel.current = null; };
  }, [tenantId, locationId]);

  const setCode = (c: string | null) => {
    try { if (c) localStorage.setItem(key, c); else localStorage.removeItem(key); } catch { /* private mode */ }
    setCodeState(c);
  };

  const sendRemote = useCallback(async (c: string, state: DisplayState) => {
    try {
      const r = await post<{ displays: number }>(`/pos/display/${c}/state`, { state });
      setRemote({ displays: r.displays, error: null });
    } catch (e) {
      const err = e as RequestError;
      if (err.code === "display_gone") setCode(null);
      setRemote({ displays: 0, error: err.message });
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
    const r = await post<{ code: string }>("/pos/display");
    setCode(r.code);
    if (last.current) void sendRemote(r.code, last.current);
    return r.code;
  };
  const unpair = async () => {
    if (code) await del(`/pos/display/${code}`).catch(() => {});
    setCode(null);
    setRemote({ displays: 0, error: null });
  };

  return { publish, code, pair, unpair, remote };
}
