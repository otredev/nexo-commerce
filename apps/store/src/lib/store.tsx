import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { computeSale, formatMoney, shippingFor, unitInfo, type Fulfillment, type StoreInfo, type UnitCode } from "@nexo/shared";
import { api, RequestError } from "./api";

export interface CartLine {
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  image: string | null;
  unit: UnitCode;
  /** Stored price and tax: the cart total is computed exactly like the server does. */
  priceCents: number;
  taxRateBps: number;
  displayPriceCents: number;
  /** null = not tracked (always available). */
  available: number | null;
  quantity: number;
}

interface StoreState {
  slug: string;
  store: StoreInfo | null;
  error: RequestError | null;
  money: (cents: number) => string;
  cart: CartLine[];
  count: number;
  add: (line: CartLine) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  replace: (lines: CartLine[]) => void;
  clear: () => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  totals: (fulfillment: Fulfillment) => { itemsCents: number; taxCents: number; shippingCents: number; totalCents: number };
}

const Ctx = createContext<StoreState | null>(null);
const key = (slug: string) => `nx-cart:${slug}`;

function readCart(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(key(slug));
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.variantId === "string" && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => readCart(slug));
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    setStore(null);
    setError(null);
    setCart(readCart(slug));
    api<StoreInfo>("GET", `/${slug}`).then(setStore, (e: RequestError) => setError(e));
  }, [slug]);
  useEffect(() => {
    try { localStorage.setItem(key(slug), JSON.stringify(cart)); } catch { /* private mode: the cart lives in memory */ }
  }, [cart, slug]);
  useEffect(() => {
    if (store) document.title = store.name;
  }, [store]);

  const money = useCallback((cents: number) => formatMoney(cents, store?.currency ?? "MXN", store?.locale ?? "es-MX"), [store]);
  const clampQty = (l: CartLine, q: number) => (l.available === null ? q : Math.min(q, l.available));

  const value = useMemo<StoreState>(() => ({
    slug,
    store,
    error,
    money,
    cart,
    count: cart.reduce((a, l) => a + (unitInfo(l.unit).decimals ? 1 : l.quantity), 0),
    add: (line) => setCart((all) => {
      const found = all.find((l) => l.variantId === line.variantId);
      if (!found) return [...all, { ...line, quantity: clampQty(line, line.quantity) }];
      return all.map((l) => (l.variantId === line.variantId ? { ...line, quantity: clampQty(line, l.quantity + line.quantity) } : l));
    }),
    setQuantity: (variantId, quantity) => setCart((all) => all.map((l) => (l.variantId === variantId ? { ...l, quantity: clampQty(l, quantity) } : l)).filter((l) => l.quantity > 0)),
    remove: (variantId) => setCart((all) => all.filter((l) => l.variantId !== variantId)),
    replace: setCart,
    clear: () => setCart([]),
    cartOpen,
    setCartOpen,
    totals: (fulfillment) => {
      const t = computeSale(cart.map((l) => ({ unitPriceCents: l.priceCents, quantity: l.quantity, discountCents: 0, taxRateBps: l.taxRateBps })), 0, store?.pricesIncludeTax ?? true);
      const shippingCents = store ? shippingFor(store, t.totalCents, fulfillment) : 0;
      return { itemsCents: t.totalCents, taxCents: t.taxCents, shippingCents, totalCents: t.totalCents + shippingCents };
    },
  }), [slug, store, error, money, cart, cartOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside StoreProvider");
  return ctx;
}

/** Products sold by weight or volume step by a quarter; everything else by whole units. */
export const stepFor = (unit: UnitCode) => (unitInfo(unit).decimals ? 0.25 : 1);
