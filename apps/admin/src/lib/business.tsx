import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatMoney, type BusinessSettings, type Location, type TaxRate } from "@nexo/shared";
import { get } from "./api";

interface BusinessState {
  settings: BusinessSettings | null;
  taxes: TaxRate[];
  locations: Location[];
  reload: () => Promise<void>;
  money: (cents: number | null | undefined) => string;
  defaultTax: TaxRate | null;
  taxFor: (taxRateId: string | null) => TaxRate | null;
}

const Ctx = createContext<BusinessState | null>(null);

/** Business settings, taxes and locations, loaded once for every screen. */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const reload = useCallback(async () => {
    const [s, t, l] = await Promise.all([get<BusinessSettings>("/settings"), get<TaxRate[]>("/taxes"), get<Location[]>("/locations")]);
    setSettings(s);
    setTaxes(t);
    setLocations(l);
  }, []);
  useEffect(() => {
    void reload().catch(() => {});
  }, [reload]);

  const value = useMemo<BusinessState>(() => {
    const defaultTax = taxes.find((t) => t.isDefault) ?? null;
    return {
      settings,
      taxes,
      locations,
      reload,
      defaultTax,
      taxFor: (id) => (id ? (taxes.find((t) => t.id === id) ?? null) : defaultTax),
      money: (cents) => (cents === null || cents === undefined ? "—" : formatMoney(cents, settings?.currency ?? "MXN", settings?.locale ?? "es-MX")),
    };
  }, [settings, taxes, locations, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBusiness() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBusiness outside BusinessProvider");
  return ctx;
}

/** Cents → editable text ("1240.50"). */
export const centsToInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));
