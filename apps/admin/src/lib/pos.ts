import { useEffect, useState } from "react";
import type { PosProduct } from "@nexo/shared";

export interface CartLine {
  key: string;
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  unit: PosProduct["unit"];
  priceCents: number;
  taxRateBps: number;
  quantity: number;
  discountCents: number;
  stock: number | null;
}

export interface Cart {
  lines: CartLine[];
  discountCents: number;
  customerName: string;
  customerContact: string;
}

export const EMPTY_CART: Cart = { lines: [], discountCents: 0, customerName: "", customerContact: "" };

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the cart simply is not kept across reloads */
  }
};

/** State kept in this browser only (cart in progress, chosen location), so a reload never loses a sale. */
export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => write(key, value), [key, value]);
  return [value, setValue] as const;
}

export const lineLabel = (l: { name: string; options: string[] }) => (l.options.length ? `${l.name} · ${l.options.join(" / ")}` : l.name);

export function newClientId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Suggested cash amounts: exact, then the next round bills above the total. */
export function quickCash(totalCents: number): number[] {
  const bills = [2000, 5000, 10000, 20000, 50000, 100000];
  const out = new Set<number>([totalCents]);
  for (const step of [1000, 5000, 10000]) out.add(Math.ceil(totalCents / step) * step);
  for (const b of bills) if (b > totalCents) out.add(b);
  return [...out].filter((v) => v >= totalCents).sort((a, b) => a - b).slice(0, 5);
}
