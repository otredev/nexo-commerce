/**
 * Pricing with promotions and coupons. The SAME function runs in the POS, the online store and
 * the server, so what the customer sees is exactly what gets charged.
 *
 * Order of discounts:
 *   1. Automatic promotion per line (the best one that applies; they never stack).
 *   2. Manual line discount given by the cashier (on what is left of the line).
 *   3. Coupon on the subtotal after line discounts (needs its minimum purchase).
 *   4. Manual cart discount.
 */
import { computeSale, lineGross, type SaleTotals } from "./sales";
import type { BasisPoints, Cents } from "./money";

export type Channel = "pos" | "online";

export interface PromotionRule {
  id: string;
  name: string;
  percentBps: BasisPoints;
  target: "all" | "category" | "product";
  targetIds: string[];
  channel: "all" | Channel;
  /** Only when the register sale has an identified customer (never online). */
  membersOnly: boolean;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
}

export interface CouponRule {
  code: string;
  kind: "percent" | "amount";
  /** Basis points for percent, cents for amount. */
  value: number;
  minSubtotalCents: Cents;
  maxUses: number | null;
  usesCount: number;
  channel: "all" | Channel;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
}

/** Is it valid on `today` (YYYY-MM-DD, business time zone) for this channel? */
export function isLive(r: { active: boolean; channel: "all" | Channel; startsOn: string | null; endsOn: string | null }, today: string, channel: Channel): boolean {
  return r.active && (r.channel === "all" || r.channel === channel) && (!r.startsOn || r.startsOn <= today) && (!r.endsOn || r.endsOn >= today);
}

/** Why a coupon cannot be used right now (null = usable, before checking the minimum). */
export function couponProblem(c: CouponRule, today: string, channel: Channel): string | null {
  if (!c.active) return "Este cupón ya no está activo.";
  if (c.channel !== "all" && c.channel !== channel) return c.channel === "online" ? "Este cupón solo es válido en la tienda en línea." : "Este cupón solo es válido en tienda.";
  if (c.startsOn && c.startsOn > today) return "Este cupón todavía no es válido.";
  if (c.endsOn && c.endsOn < today) return "Este cupón ya venció.";
  if (c.maxUses !== null && c.usesCount >= c.maxUses) return "Este cupón ya se agotó.";
  return null;
}

/** Best live promotion for a product (highest percentage), or null. */
export function promotionFor(promos: PromotionRule[], productId: string, categoryId: string | null): PromotionRule | null {
  let best: PromotionRule | null = null;
  for (const p of promos) {
    const applies = p.target === "all" || (p.target === "product" && p.targetIds.includes(productId)) || (p.target === "category" && categoryId !== null && p.targetIds.includes(categoryId));
    if (applies && (!best || p.percentBps > best.percentBps)) best = p;
  }
  return best;
}

export const percentOf = (cents: Cents, bps: BasisPoints) => Math.round((cents * bps) / 10_000);

export interface PricingLine {
  productId: string;
  categoryId: string | null;
  unitPriceCents: Cents;
  quantity: number;
  taxRateBps: BasisPoints;
  /** Given by hand in the POS. */
  manualDiscountCents?: Cents;
}

export interface PricingResult {
  totals: SaleTotals;
  lines: Array<{ promotionId: string | null; promotionName: string | null; promoDiscountCents: Cents; manualDiscountCents: Cents }>;
  couponDiscountCents: Cents;
  /** Shown to the customer/cashier when a coupon was given but does not apply. */
  couponError: string | null;
  /** Promotions + coupon. */
  promoDiscountCents: Cents;
  /** Line + cart discounts given by hand (checked against the cashier's limit). */
  manualDiscountCents: Cents;
}

export function priceCart(
  lines: PricingLine[],
  opts: { promotions: PromotionRule[]; coupon: CouponRule | null; manualCartDiscountCents?: Cents; pricesIncludeTax: boolean; formatMoney?: (c: Cents) => string },
): PricingResult {
  const perLine = lines.map((l) => {
    const gross = lineGross(l.unitPriceCents, l.quantity);
    const promo = promotionFor(opts.promotions, l.productId, l.categoryId);
    const promoDiscountCents = promo ? percentOf(gross, promo.percentBps) : 0;
    const manualDiscountCents = Math.max(0, Math.min(l.manualDiscountCents ?? 0, gross - promoDiscountCents));
    return { gross, promo, promoDiscountCents, manualDiscountCents };
  });
  const afterLines = perLine.reduce((a, l) => a + l.gross - l.promoDiscountCents - l.manualDiscountCents, 0);

  let couponDiscountCents = 0;
  let couponError: string | null = null;
  if (opts.coupon) {
    const c = opts.coupon;
    if (afterLines < c.minSubtotalCents) {
      couponError = `Este cupón requiere una compra mínima de ${opts.formatMoney ? opts.formatMoney(c.minSubtotalCents) : (c.minSubtotalCents / 100).toFixed(2)}.`;
    } else {
      couponDiscountCents = Math.min(c.kind === "percent" ? percentOf(afterLines, c.value) : c.value, afterLines);
    }
  }
  const manualCart = Math.max(0, Math.min(opts.manualCartDiscountCents ?? 0, afterLines - couponDiscountCents));

  const totals = computeSale(
    lines.map((l, i) => ({ unitPriceCents: l.unitPriceCents, quantity: l.quantity, taxRateBps: l.taxRateBps, discountCents: perLine[i]!.promoDiscountCents + perLine[i]!.manualDiscountCents })),
    couponDiscountCents + manualCart,
    opts.pricesIncludeTax,
  );
  const linePromo = perLine.reduce((a, l) => a + l.promoDiscountCents, 0);
  return {
    totals,
    lines: perLine.map((l) => ({ promotionId: l.promo?.id ?? null, promotionName: l.promo?.name ?? null, promoDiscountCents: l.promoDiscountCents, manualDiscountCents: l.manualDiscountCents })),
    couponDiscountCents,
    couponError,
    promoDiscountCents: linePromo + couponDiscountCents,
    manualDiscountCents: perLine.reduce((a, l) => a + l.manualDiscountCents, 0) + manualCart,
  };
}

/** Unit price after the best promotion (for showing "antes / ahora" in the store). */
export function promoUnitPrice(priceCents: Cents, promo: PromotionRule | null): Cents {
  return promo ? priceCents - percentOf(priceCents, promo.percentBps) : priceCents;
}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");
