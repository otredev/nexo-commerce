import { describe, expect, it } from "vitest";
import { couponProblem, isLive, priceCart, promotionFor, type CouponRule, type PromotionRule } from "./promotions";

const promo = (p: Partial<PromotionRule>): PromotionRule => ({ id: "p", name: "Promo", percentBps: 1000, target: "all", targetIds: [], channel: "all", membersOnly: false, startsOn: null, endsOn: null, active: true, ...p });
const coupon = (c: Partial<CouponRule>): CouponRule => ({ code: "HOLA", kind: "percent", value: 1000, minSubtotalCents: 0, maxUses: null, usesCount: 0, channel: "all", startsOn: null, endsOn: null, active: true, ...c });

describe("promotions", () => {
  it("is live only inside its dates and channel", () => {
    const p = promo({ startsOn: "2026-11-01", endsOn: "2026-11-30", channel: "online" });
    expect(isLive(p, "2026-11-15", "online")).toBe(true);
    expect(isLive(p, "2026-11-15", "pos")).toBe(false);
    expect(isLive(p, "2026-12-01", "online")).toBe(false);
    expect(isLive({ ...p, active: false }, "2026-11-15", "online")).toBe(false);
  });
  it("picks the best promotion and never stacks", () => {
    const list = [promo({ id: "all", percentBps: 500 }), promo({ id: "cat", percentBps: 2000, target: "category", targetIds: ["c1"] }), promo({ id: "prod", percentBps: 1500, target: "product", targetIds: ["x"] })];
    expect(promotionFor(list, "x", "c1")!.id).toBe("cat");
    expect(promotionFor(list, "x", null)!.id).toBe("prod");
    expect(promotionFor(list, "y", "c2")!.id).toBe("all");
    expect(promotionFor([], "y", null)).toBeNull();
  });
});

describe("priceCart", () => {
  const lines = [
    { productId: "a", categoryId: "c1", unitPriceCents: 10000, quantity: 2, taxRateBps: 1600 },
    { productId: "b", categoryId: null, unitPriceCents: 5000, quantity: 1, taxRateBps: 1600 },
  ];
  it("applies line promotions, then the coupon on what is left", () => {
    const r = priceCart(lines, { promotions: [promo({ percentBps: 2000, target: "category", targetIds: ["c1"] })], coupon: coupon({ value: 1000 }), pricesIncludeTax: true });
    // a: 200 − 40 = 160; b: 50 → 210; coupon 10 % = 21 → 189
    expect(r.lines[0]!.promoDiscountCents).toBe(4000);
    expect(r.couponDiscountCents).toBe(2100);
    expect(r.totals.totalCents).toBe(18900);
    expect(r.promoDiscountCents).toBe(6100);
    expect(r.manualDiscountCents).toBe(0);
  });
  it("rejects a coupon under its minimum and keeps manual discounts separate", () => {
    const r = priceCart(lines, { promotions: [], coupon: coupon({ kind: "amount", value: 3000, minSubtotalCents: 30000 }), manualCartDiscountCents: 500, pricesIncludeTax: true, formatMoney: (c) => `$${c / 100}` });
    expect(r.couponDiscountCents).toBe(0);
    expect(r.couponError).toContain("$300");
    expect(r.manualDiscountCents).toBe(500);
    expect(r.totals.totalCents).toBe(24500);
  });
  it("caps an amount coupon at the subtotal", () => {
    const r = priceCart([lines[1]!], { promotions: [], coupon: coupon({ kind: "amount", value: 99999 }), pricesIncludeTax: true });
    expect(r.totals.totalCents).toBe(0);
  });
  it("explains why a coupon cannot be used", () => {
    expect(couponProblem(coupon({ maxUses: 5, usesCount: 5 }), "2026-11-01", "pos")).toContain("agotó");
    expect(couponProblem(coupon({ endsOn: "2026-10-31" }), "2026-11-01", "pos")).toContain("venció");
    expect(couponProblem(coupon({ channel: "online" }), "2026-11-01", "pos")).toContain("en línea");
    expect(couponProblem(coupon({}), "2026-11-01", "pos")).toBeNull();
  });
});
