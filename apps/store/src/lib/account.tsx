/**
 * The signed-in customer of this store. Browsing and the cart never need it; paying does when the store
 * asks for an account. The cart lives in the browser, so signing in or up never loses it.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { StoreAccount } from "@nexo/shared";
import { api } from "./api";

interface AccountState {
  account: StoreAccount | null;
  /** The first answer from the server arrived. */
  ready: boolean;
  setAccount: (a: StoreAccount | null) => void;
  refresh: () => Promise<StoreAccount | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AccountState | null>(null);

export function AccountProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [account, setAccount] = useState<StoreAccount | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ account: StoreAccount | null }>("GET", `/${slug}/account`);
      setAccount(r.account);
      return r.account;
    } catch {
      setAccount(null);
      return null;
    } finally {
      setReady(true);
    }
  }, [slug]);
  useEffect(() => {
    setReady(false);
    void refresh();
  }, [refresh]);
  const logout = useCallback(async () => {
    await api("POST", `/${slug}/account/logout`).catch(() => {});
    setAccount(null);
  }, [slug]);
  return <Ctx.Provider value={{ account, ready, setAccount, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAccount() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAccount outside AccountProvider");
  return ctx;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
