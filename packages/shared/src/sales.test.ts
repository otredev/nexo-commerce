import { describe, expect, it } from "vitest";
import { businessDate, computeSale, settle } from "./sales";

describe("computeSale", () => {
  it("splits tax out of tax-inclusive prices per line", () => {
    const t = computeSale([{ unitPriceCents: 11600, quantity: 2, discountCents: 0, taxRateBps: 1600 }, { unitPriceCents: 4500, quantity: 1, discountCents: 0, taxRateBps: 0 }], 0, true);
    expect(t.totalCents).toBe(27700);
    expect(t.taxCents).toBe(3200);
    expect(t.netCents + t.taxCents).toBe(t.totalCents);
  });

  it("adds tax on top when prices exclude it", () => {
    const t = computeSale([{ unitPriceCents: 10000, quantity: 1, discountCents: 0, taxRateBps: 1600 }], 0, false);
    expect(t.totalCents).toBe(11600);
    expect(t.subtotalCents).toBe(10000);
  });

  it("prices fractional quantities", () => {
    expect(computeSale([{ unitPriceCents: 25000, quantity: 0.75, discountCents: 0, taxRateBps: 0 }], 0, true).totalCents).toBe(18750);
  });

  it("distributes the cart discount without losing cents", () => {
    const lines = [1, 2, 3].map((n) => ({ unitPriceCents: 3333 * n, quantity: 1, discountCents: 0, taxRateBps: 1600 }));
    const t = computeSale(lines, 1001, true);
    expect(t.lines.reduce((a, l) => a + l.cartDiscountCents, 0)).toBe(1001);
    expect(t.discountCents).toBe(1001);
    expect(t.totalCents).toBe(t.subtotalCents - 1001);
  });

  it("caps discounts at the line and cart amount", () => {
    const t = computeSale([{ unitPriceCents: 1000, quantity: 1, discountCents: 5000, taxRateBps: 0 }], 99999, true);
    expect(t.totalCents).toBe(0);
    expect(t.discountCents).toBe(1000);
  });
});

describe("settle", () => {
  it("gives change only from cash", () => {
    expect(settle(9550, [{ method: "cash", amountCents: 10000 }])).toEqual({ ok: true, changeCents: 450, paidCents: 10000 });
    expect(settle(9550, [{ method: "card", amountCents: 10000 }]).ok).toBe(false);
    expect(settle(9550, [{ method: "card", amountCents: 5000 }, { method: "cash", amountCents: 5000 }])).toEqual({ ok: true, changeCents: 450, paidCents: 10000 });
    expect(settle(9550, [{ method: "cash", amountCents: 9000 }]).ok).toBe(false);
  });
});

describe("businessDate", () => {
  it("uses the business time zone", () => {
    const at = new Date("2026-11-02T03:30:00Z"); // 21:30 on Nov 1 in Mexico City
    expect(businessDate("America/Mexico_City", at)).toBe("2026-11-01");
    expect(businessDate("Europe/Madrid", at)).toBe("2026-11-02");
  });
});
