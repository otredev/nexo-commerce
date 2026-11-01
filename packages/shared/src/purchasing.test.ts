import { describe, expect, it } from "vitest";
import { computePurchase, docNumber, dueDate, suggestedReorderMilli } from "./purchasing";

describe("computePurchase", () => {
  it("rounds per line and adds tax on the net", () => {
    const t = computePurchase([
      { quantityMilli: 3000, unitCostCents: 1033, taxRateBps: 1600 },
      { quantityMilli: 1250, unitCostCents: 8999, taxRateBps: 0 },
    ]);
    expect(t.lines[0]).toEqual({ netCents: 3099, taxCents: 496, totalCents: 3595 });
    expect(t.lines[1]!.netCents).toBe(11249);
    expect(t.subtotalCents).toBe(14348);
    expect(t.taxCents).toBe(496);
    expect(t.totalCents).toBe(14844);
  });
  it("is empty for no lines", () => {
    expect(computePurchase([]).totalCents).toBe(0);
  });
});

describe("suggestedReorderMilli", () => {
  it("brings stock up to twice the minimum", () => {
    expect(suggestedReorderMilli(2000, 5000, false)).toBe(8000);
    expect(suggestedReorderMilli(0, 5000, false)).toBe(10000);
  });
  it("treats negative stock as zero and rounds up whole units", () => {
    expect(suggestedReorderMilli(-1000, 3000, false)).toBe(6000);
    expect(suggestedReorderMilli(1500, 2500, false)).toBe(4000);
    expect(suggestedReorderMilli(1500, 2500, true)).toBe(3500);
  });
  it("suggests nothing above the minimum or without one", () => {
    expect(suggestedReorderMilli(6000, 5000, false)).toBe(0);
    expect(suggestedReorderMilli(0, 0, false)).toBe(0);
  });
});

describe("documents", () => {
  it("formats numbers with prefix", () => {
    expect(docNumber("purchase", 12)).toBe("OC-000012");
    expect(docNumber("transfer", 4)).toBe("TR-000004");
  });
  it("computes due dates across months", () => {
    expect(dueDate("2026-01-20", 30)).toBe("2026-02-19");
    expect(dueDate("2026-11-01", 0)).toBe("2026-11-01");
  });
});
