/**
 * Catalog and inventory primitives shared by the API and the dashboard.
 *
 * Quantities travel through the API as plain numbers in the product's unit (1.25 kg)
 * and are stored as integer thousandths ("milli-units") so the stock CHECK (>= 0) never
 * fights floating point. Money is always integer cents.
 */
import { splitGross, type BasisPoints, type Cents } from "./money";

export const UNITS = [
  { code: "unit", label: "Pieza", short: "pza", decimals: false },
  { code: "kg", label: "Kilogramo", short: "kg", decimals: true },
  { code: "g", label: "Gramo", short: "g", decimals: false },
  { code: "l", label: "Litro", short: "l", decimals: true },
  { code: "ml", label: "Mililitro", short: "ml", decimals: false },
  { code: "m", label: "Metro", short: "m", decimals: true },
  { code: "box", label: "Caja", short: "caja", decimals: false },
  { code: "pack", label: "Paquete", short: "paq", decimals: false },
  { code: "service", label: "Servicio", short: "serv", decimals: false },
] as const;
export type UnitCode = (typeof UNITS)[number]["code"];
export const UNIT_CODES = UNITS.map((u) => u.code) as [UnitCode, ...UnitCode[]];
export const unitInfo = (code: string) => UNITS.find((u) => u.code === code) ?? UNITS[0];

export const QTY_SCALE = 1000;
export const toMilli = (qty: number) => Math.round(qty * QTY_SCALE);
export const fromMilli = (milli: number) => milli / QTY_SCALE;

/** True when the quantity is valid for the unit (whole numbers unless the unit allows decimals, max 3 decimals). */
export function quantityFitsUnit(qty: number, unit: string): boolean {
  if (!Number.isFinite(qty)) return false;
  if (!unitInfo(unit).decimals) return Number.isInteger(qty);
  return Math.abs(qty * QTY_SCALE - Math.round(qty * QTY_SCALE)) < 1e-6;
}

export function formatQty(qty: number, unit: string, locale = "es-MX"): string {
  const u = unitInfo(unit);
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: u.decimals ? 3 : 0 }).format(qty);
  return `${n} ${u.short}`;
}

/**
 * Gross margin of a sale price over the average cost, in basis points.
 * When prices include tax, the margin is computed on the net price (what the business keeps).
 */
export function marginFor(priceCents: Cents, costCents: Cents, rateBps: BasisPoints, pricesIncludeTax: boolean): BasisPoints | null {
  const net = pricesIncludeTax ? splitGross(priceCents, rateBps).net : priceCents;
  if (net <= 0) return null;
  return Math.round(((net - costCents) * 10_000) / net);
}

/** Lowercase, accent-free text used for searching ("Café Olé" → "cafe ole"). */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every combination of option values: [["S","M"],["Rojo"]] → [["S","Rojo"],["M","Rojo"]]. */
export function combinations(values: string[][]): string[][] {
  return values.reduce<string[][]>((acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])), [[]]);
}

export const MOVEMENT_TYPES = ["initial", "in", "out", "adjust"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  initial: "Inventario inicial",
  in: "Entrada",
  out: "Salida",
  adjust: "Ajuste por conteo",
};

/** Reasons the user can pick for a manual movement, grouped by direction. */
export const MOVEMENT_REASONS = {
  in: [
    { code: "purchase", label: "Compra a proveedor" },
    { code: "customer_return", label: "Devolución de cliente" },
    { code: "found", label: "Sobrante encontrado" },
    { code: "other_in", label: "Otro motivo" },
  ],
  out: [
    { code: "damage", label: "Merma o daño" },
    { code: "expired", label: "Caducado" },
    { code: "loss", label: "Robo o extravío" },
    { code: "internal_use", label: "Uso interno" },
    { code: "supplier_return", label: "Devolución a proveedor" },
    { code: "other_out", label: "Otro motivo" },
  ],
  set: [{ code: "count", label: "Conteo físico" }],
} as const;

export const ALL_REASONS: Record<string, string> = {
  initial: "Carga inicial",
  import: "Importación CSV",
  ...Object.fromEntries(Object.values(MOVEMENT_REASONS).flat().map((r) => [r.code, r.label])),
};
export const REASON_CODES = Object.values(MOVEMENT_REASONS).flat().map((r) => r.code) as [string, ...string[]];

/** Stock status of a variant: out when nothing left, low when at or under its minimum. */
export type StockStatus = "ok" | "low" | "out" | "untracked";
export function stockStatus(qty: number, minStock: number, tracked = true): StockStatus {
  if (!tracked) return "untracked";
  if (qty <= 0) return "out";
  if (minStock > 0 && qty <= minStock) return "low";
  return "ok";
}
