/** Operator session of the /admin panel (cookie nx_platform). */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { OperatorMe } from "@nexo/shared";
import { get, post } from "../lib/api";

interface OperatorState {
  me: OperatorMe | null;
  ready: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<OperatorState | null>(null);

export function OperatorProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<OperatorMe | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setMe(await get<OperatorMe>("/platform/me"));
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setMe(null);
    window.addEventListener("nx:unauthorized", onUnauthorized);
    return () => window.removeEventListener("nx:unauthorized", onUnauthorized);
  }, [refresh]);
  const logout = useCallback(async () => {
    await post("/platform/auth/logout").catch(() => {});
    setMe(null);
  }, []);
  return <Ctx.Provider value={{ me, ready, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useOperator() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOperator outside OperatorProvider");
  return ctx;
}

const dateTime = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const date = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : "—");
export const fmtDate = (iso: string | null | undefined) => (iso ? date.format(new Date(iso)) : "—");

/** "hace 5 min", "hace 3 h", "hace 2 días" — for queues and last sign-in. */
export function ago(iso: string | null | undefined) {
  if (!iso) return "nunca";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86_400);
  return d < 30 ? `hace ${d} ${d === 1 ? "día" : "días"}` : fmtDate(iso);
}
