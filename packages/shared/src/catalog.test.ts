import { describe, expect, it } from "vitest";
import { combinations, fromMilli, marginFor, normalizeSearch, quantityFitsUnit, stockStatus, toMilli } from "./catalog";
import { productInputSchema } from "./schemas";

describe("quantities", () => {
  it("stores thousandths without float errors", () => {
    expect(toMilli(0.1 + 0.2)).toBe(300);
    expect(fromMilli(toMilli(12.345))).toBe(12.345);
  });
  it("only allows decimals for units that accept them", () => {
    expect(quantityFitsUnit(1.5, "unit")).toBe(false);
    expect(quantityFitsUnit(2, "unit")).toBe(true);
    expect(quantityFitsUnit(1.25, "kg")).toBe(true);
    expect(quantityFitsUnit(1.2345, "kg")).toBe(false);
  });
});

describe("margin", () => {
  it("uses the net price when prices include tax", () => {
    // 116 with 16 % tax → net 100, cost 60 → 40 %
    expect(marginFor(11600, 6000, 1600, true)).toBe(4000);
    expect(marginFor(10000, 6000, 1600, false)).toBe(4000);
    expect(marginFor(0, 100, 0, true)).toBeNull();
  });
});

describe("helpers", () => {
  it("builds every combination of options", () => {
    expect(combinations([["S", "M"], ["Rojo", "Azul"]])).toEqual([["S", "Rojo"], ["S", "Azul"], ["M", "Rojo"], ["M", "Azul"]]);
    expect(combinations([])).toEqual([[]]);
  });
  it("normalizes search text", () => {
    expect(normalizeSearch("  Café   OLÉ ")).toBe("cafe ole");
  });
  it("computes stock status", () => {
    expect(stockStatus(0, 5)).toBe("out");
    expect(stockStatus(5, 5)).toBe("low");
    expect(stockStatus(6, 5)).toBe("ok");
    expect(stockStatus(3, 0)).toBe("ok");
    expect(stockStatus(0, 0, false)).toBe("untracked");
  });
});

describe("product schema", () => {
  const base = { name: "Camisa", optionNames: ["Talla"], variants: [{ options: ["M"], priceCents: 100 }, { options: ["L"], priceCents: 100 }] };
  it("accepts variants and uppercases SKUs", () => {
    const r = productInputSchema.parse({ ...base, variants: [{ ...base.variants[0], sku: "cam-m" }, base.variants[1]] });
    expect(r.variants[0]!.sku).toBe("CAM-M");
  });
  it("rejects repeated combinations and SKUs", () => {
    expect(productInputSchema.safeParse({ ...base, variants: [{ options: ["M"], priceCents: 1 }, { options: ["m"], priceCents: 1 }] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, variants: [{ options: ["M"], priceCents: 1, sku: "A" }, { options: ["L"], priceCents: 1, sku: "a" }] }).success).toBe(false);
  });
  it("requires exactly one variant without options", () => {
    expect(productInputSchema.safeParse({ name: "Taza", variants: [{ priceCents: 1 }, { priceCents: 2 }] }).success).toBe(false);
  });
});
