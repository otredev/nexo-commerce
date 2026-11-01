/**
 * Money is always stored as integer minor units (cents). Never use floats for amounts.
 * Tax rates are stored as basis points: 1600 = 16.00 %.
 */

export type Cents = number;
export type BasisPoints = number;

/** Parses user input like "1,240.50" or "1240,5" into cents. Returns null if invalid. */
export function parseMoney(input: string | number): Cents | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.trim().replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  // The last separator is the decimal one; the others are thousands separators.
  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  let normalized: string;
  if (lastSep === -1) {
    normalized = cleaned;
  } else {
    const decimals = cleaned.slice(lastSep + 1);
    const whole = cleaned.slice(0, lastSep).replace(/[.,]/g, "");
    const separators = new Set(cleaned.match(/[.,]/g));
    // "1,240" or "1,240,000" (a single kind of separator, 3 digits after the last) is a thousands separator.
    normalized = separators.size === 1 && decimals.length === 3 ? whole + decimals : `${whole}.${decimals}`;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatMoney(cents: Cents, currency = "MXN", locale = "es-MX"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function percentToBps(percent: number): BasisPoints {
  return Math.round(percent * 100);
}

export function bpsToPercent(bps: BasisPoints): number {
  return bps / 100;
}

/** Tax amount for a net (tax-exclusive) amount, rounded half up to the cent. */
export function taxOnNet(net: Cents, rate: BasisPoints): Cents {
  return Math.round((net * rate) / 10_000);
}

/** Splits a gross (tax-inclusive) amount into net + tax. */
export function splitGross(gross: Cents, rate: BasisPoints): { net: Cents; tax: Cents } {
  const net = Math.round((gross * 10_000) / (10_000 + rate));
  return { net, tax: gross - net };
}

/** Gross margin in basis points: (price - cost) / price. */
export function marginBps(price: Cents, cost: Cents): BasisPoints | null {
  if (price <= 0) return null;
  return Math.round(((price - cost) * 10_000) / price);
}
