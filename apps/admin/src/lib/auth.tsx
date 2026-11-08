import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { can, type MeResponse, type Permission } from "@nexo/shared";
import { get, post } from "./api";

interface AuthState {
  me: MeResponse | null;
  ready: boolean;
  refresh: () => Promise<void>;
  setMe: (me: MeResponse | null) => void;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await get<MeResponse>("/me"));
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setMe(null);
    const onTenantStatus = () => void refresh();
    window.addEventListener("nx:unauthorized", onUnauthorized);
    window.addEventListener("nx:tenant-status", onTenantStatus);
    return () => {
      window.removeEventListener("nx:unauthorized", onUnauthorized);
      window.removeEventListener("nx:tenant-status", onTenantStatus);
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    await post("/auth/logout").catch(() => {});
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, ready, refresh, setMe, logout, can: (p) => (me ? (me.permissions ?? []).includes(p) || (!me.permissions && can(me.role, p)) : false) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
