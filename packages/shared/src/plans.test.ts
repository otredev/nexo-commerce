import { describe, expect, it } from "vitest";
import { planOf, PLANS, withinLimit } from "./plans";

describe("plans", () => {
  it("falls back to free for unknown plans", () => {
    expect(planOf("enterprise-x").id).toBe("free");
    expect(planOf(null).id).toBe("free");
    expect(planOf("pro").limits.cardPayments).toBe(true);
  });
  it("checks limits, with null as unlimited", () => {
    expect(withinLimit(2, 1)).toBe(true);
    expect(withinLimit(2, 2)).toBe(false);
    expect(withinLimit(100, 95, 10)).toBe(false);
    expect(withinLimit(null, 1_000_000)).toBe(true);
  });
  it("orders plans from smaller to larger", () => {
    expect(PLANS.free.limits.products! < PLANS.pro.limits.products!).toBe(true);
    expect(PLANS.business.limits.products).toBeNull();
  });
});
