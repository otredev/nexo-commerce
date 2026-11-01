import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatMoney, priceCart, promotionFor, promoUnitPrice, shippingFor, unitInfo, type CouponRule, type Fulfillment, type StoreInfo, type UnitCode } from "@nexo/shared";
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
  /** For category promotions. */
  categoryId?: string | null;
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
  /** Reloads the store (prices, promotions) after the server says something changed. */
  reload: () => Promise<void>;
  coupon: CouponRule | null;
  setCoupon: (c: CouponRule | null) => void;
  totals: (fulfillment: Fulfillment) => { itemsCents: number; subtotalCents: number; discountCents: number; couponDiscountCents: number; couponError: string | null; taxCents: number; shippingCents: number; totalCents: number };
  /** What the customer pays per unit for a cart line, after its promotion. */
  linePrice: (line: CartLine) => number;
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
  const [coupon, setCoupon] = useState<CouponRule | null>(null);

  useEffect(() => {
    setStore(null);
    setError(null);
    setCart(readCart(slug));
    api<StoreInfo>("GET", `/${slug}`).then(setStore, (e: RequestError) => setError(e));
  }, [slug]);
  const reload = useCallback(async () => { setStore(await api<StoreInfo>("GET", `/${slug}`)); }, [slug]);
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
    reload,
    coupon,
    setCoupon,
    // Same pricing as the server: promotions per line, then the coupon.
    totals: (fulfillment) => {
      const p = priceCart(
        cart.map((l) => ({ productId: l.productId, categoryId: l.categoryId ?? null, unitPriceCents: l.priceCents, quantity: l.quantity, taxRateBps: l.taxRateBps })),
        { promotions: store?.promotions ?? [], coupon, pricesIncludeTax: store?.pricesIncludeTax ?? true, formatMoney: money },
      );
      const t = p.totals;
      const shippingCents = store ? shippingFor(store, t.totalCents, fulfillment) : 0;
      // Subtotal shown with taxes (gross) whatever the pricing mode, like every price in the store.
      const gross = t.totalCents + t.discountCents;
      return { itemsCents: t.totalCents, subtotalCents: gross, discountCents: t.discountCents, couponDiscountCents: p.couponDiscountCents, couponError: p.couponError, taxCents: t.taxCents, shippingCents, totalCents: t.totalCents + shippingCents };
    },
    linePrice: (line) => promoUnitPrice(line.displayPriceCents, promotionFor(store?.promotions ?? [], line.productId, line.categoryId ?? null)),
  }), [slug, store, error, money, cart, cartOpen, coupon, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside StoreProvider");
  return ctx;
}

/** Products sold by weight or volume step by a quarter; everything else by whole units. */
export const stepFor = (unit: UnitCode) => (unitInfo(unit).decimals ? 0.25 : 1);
