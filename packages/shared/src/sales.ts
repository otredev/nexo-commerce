/**
 * Sale math shared by the POS (live preview) and the API (authoritative).
 * The API never trusts totals from the client: it recomputes them with this same function
 * using the prices and taxes stored in the database.
 */
import { splitGross, taxOnNet, type BasisPoints, type Cents } from "./money";
import { toMilli } from "./catalog";

export interface SaleLineInput {
  unitPriceCents: Cents;
  /** In the product's unit (1.25 kg). */
  quantity: number;
  /** Discount for the whole line, in cents. */
  discountCents: Cents;
  taxRateBps: BasisPoints;
}

export interface SaleLineTotals {
  grossCents: Cents;
  lineDiscountCents: Cents;
  /** Share of the cart discount assigned to this line. */
  cartDiscountCents: Cents;
  netCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export interface SaleTotals {
  lines: SaleLineTotals[];
  /** Sum of list prices × quantities, before discounts. */
  subtotalCents: Cents;
  discountCents: Cents;
  netCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export const lineGross = (unitPriceCents: Cents, quantity: number) => Math.round((unitPriceCents * toMilli(quantity)) / 1000);

export function computeSale(lines: SaleLineInput[], cartDiscountCents: Cents, pricesIncludeTax: boolean): SaleTotals {
  const gross = lines.map((l) => lineGross(l.unitPriceCents, l.quantity));
  const lineDisc = lines.map((l, i) => Math.max(0, Math.min(l.discountCents, gross[i]!)));
  const after = gross.map((g, i) => g - lineDisc[i]!);
  const afterSum = after.reduce((a, b) => a + b, 0);
  const cartDisc = Math.max(0, Math.min(cartDiscountCents, afterSum));

  // Distribute the cart discount proportionally; the rounding remainder goes to the largest lines.
  const shares = after.map((a) => (afterSum ? Math.floor((cartDisc * a) / afterSum) : 0));
  let remainder = cartDisc - shares.reduce((a, b) => a + b, 0);
  const order = after.map((a, i) => [a, i] as const).sort((x, y) => y[0] - x[0]);
  for (const [, i] of order) {
    if (remainder <= 0) break;
    if (after[i]! - shares[i]! > 0) { shares[i]!++; remainder--; }
  }

  const out: SaleLineTotals[] = lines.map((l, i) => {
    const amount = after[i]! - shares[i]!;
    if (pricesIncludeTax) {
      const { net, tax } = splitGross(amount, l.taxRateBps);
      return { grossCents: gross[i]!, lineDiscountCents: lineDisc[i]!, cartDiscountCents: shares[i]!, netCents: net, taxCents: tax, totalCents: amount };
    }
    const tax = taxOnNet(amount, l.taxRateBps);
    return { grossCents: gross[i]!, lineDiscountCents: lineDisc[i]!, cartDiscountCents: shares[i]!, netCents: amount, taxCents: tax, totalCents: amount + tax };
  });
  const sum = (k: keyof SaleLineTotals) => out.reduce((a, l) => a + l[k], 0);
  return {
    lines: out,
    subtotalCents: sum("grossCents"),
    discountCents: sum("lineDiscountCents") + sum("cartDiscountCents"),
    netCents: sum("netCents"),
    taxCents: sum("taxCents"),
    totalCents: sum("totalCents"),
  };
}

export const PAYMENT_METHODS = [
  { code: "cash", label: "Efectivo" },
  { code: "card", label: "Tarjeta" },
  { code: "transfer", label: "Transferencia" },
  { code: "other", label: "Otro" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["code"];
export const PAYMENT_CODES = PAYMENT_METHODS.map((p) => p.code) as [PaymentMethod, ...PaymentMethod[]];
export const paymentLabel = (code: string) => PAYMENT_METHODS.find((p) => p.code === code)?.label ?? code;

/**
 * Validates the payments of a sale and returns the change.
 * Only cash can exceed what is owed (the difference is the change); card and transfer must be exact.
 */
export function settle(totalCents: Cents, payments: Array<{ method: string; amountCents: Cents }>): { ok: true; changeCents: Cents; paidCents: Cents } | { ok: false; message: string } {
  const paid = payments.reduce((a, p) => a + p.amountCents, 0);
  const cash = payments.filter((p) => p.method === "cash").reduce((a, p) => a + p.amountCents, 0);
  const nonCash = paid - cash;
  if (paid < totalCents) return { ok: false, message: "El pago no cubre el total" };
  if (nonCash > totalCents) return { ok: false, message: "Los pagos con tarjeta o transferencia no pueden superar el total" };
  const change = paid - totalCents;
  if (change > cash) return { ok: false, message: "Solo el efectivo puede generar cambio" };
  return { ok: true, changeCents: change, paidCents: paid };
}

export const formatFolio = (n: number) => `#${String(n).padStart(6, "0")}`;

/** Local calendar date (YYYY-MM-DD) of an instant in the business's time zone. */
export function businessDate(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export const VOID_REASONS = ["Error de captura", "El cliente canceló", "Cobro duplicado", "Otro"] as const;
