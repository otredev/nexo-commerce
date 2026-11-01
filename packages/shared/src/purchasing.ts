/**
 * Purchasing, transfers and physical counts: pure helpers shared by the API and the admin.
 * Quantities here are in thousandths (milli) unless the name says otherwise.
 */
import { taxOnNet, type BasisPoints, type Cents } from "./money";

export interface PurchaseLine {
  quantityMilli: number;
  /** Net cost per unit, before tax. */
  unitCostCents: Cents;
  taxRateBps: BasisPoints;
}

export interface PurchaseTotals {
  lines: Array<{ netCents: Cents; taxCents: Cents; totalCents: Cents }>;
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

/** Line net = cost × quantity (rounded per line); tax per line on the net. */
export function computePurchase(lines: PurchaseLine[]): PurchaseTotals {
  const out = lines.map((l) => {
    const netCents = Math.round((l.unitCostCents * l.quantityMilli) / 1000);
    const taxCents = taxOnNet(netCents, l.taxRateBps);
    return { netCents, taxCents, totalCents: netCents + taxCents };
  });
  const subtotalCents = out.reduce((a, l) => a + l.netCents, 0);
  const taxCents = out.reduce((a, l) => a + l.taxCents, 0);
  return { lines: out, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/**
 * Reorder suggestion for a product at or under its minimum: bring it up to twice the minimum.
 * Whole units for products sold by the unit. Returns 0 when nothing is needed.
 */
export function suggestedReorderMilli(stockMilli: number, minStockMilli: number, decimals: boolean): number {
  if (minStockMilli <= 0 || stockMilli > minStockMilli) return 0;
  const need = Math.max(minStockMilli * 2 - Math.max(stockMilli, 0), 0);
  return decimals ? need : Math.ceil(need / 1000) * 1000;
}

export const PURCHASE_STATUSES = ["draft", "ordered", "partial", "received", "cancelled"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: "Borrador",
  ordered: "Pedida",
  partial: "Recibida en parte",
  received: "Recibida",
  cancelled: "Cancelada",
};

export const TRANSFER_STATUSES = ["draft", "in_transit", "received", "cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  draft: "Borrador",
  in_transit: "En tránsito",
  received: "Recibido",
  cancelled: "Cancelado",
};

export const COUNT_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];
export const COUNT_STATUS_LABELS: Record<CountStatus, string> = {
  in_progress: "En proceso",
  completed: "Aplicado",
  cancelled: "Cancelado",
};

/** Document numbers: OC-000012 (purchase order), TR-000004 (transfer), CF-000003 (physical count). */
export const DOC_PREFIX = { purchase: "OC", transfer: "TR", count: "CF" } as const;
export const docNumber = (kind: keyof typeof DOC_PREFIX, n: number) => `${DOC_PREFIX[kind]}-${String(n).padStart(6, "0")}`;

/** Due date of a supplier invoice from the receipt date and the supplier's credit days. */
export function dueDate(receivedOn: string, termsDays: number): string {
  const d = new Date(`${receivedOn}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + termsDays);
  return d.toISOString().slice(0, 10);
}
