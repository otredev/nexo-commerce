import { describe, expect, it } from "vitest";
import { marginBps, parseMoney, splitGross, taxOnNet } from "./money";

describe("parseMoney", () => {
  it.each([
    ["1240.50", 124050],
    ["1,240.50", 124050],
    ["1.240,50", 124050],
    ["1240,5", 124050],
    ["1,240", 124000],
    ["1,240,000", 124000000],
    ["$ 99", 9900],
    ["0.1", 10],
  ])("%s -> %i", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it("rejects garbage", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});

describe("taxes", () => {
  it("computes tax on a net amount", () => {
    expect(taxOnNet(10000, 1600)).toBe(1600);
    expect(taxOnNet(999, 1600)).toBe(160);
  });

  it("splits a gross amount and keeps the total exact", () => {
    const { net, tax } = splitGross(11600, 1600);
    expect(net).toBe(10000);
    expect(tax).toBe(1600);
    const odd = splitGross(5990, 1600);
    expect(odd.net + odd.tax).toBe(5990);
  });
});

describe("marginBps", () => {
  it("returns the gross margin", () => {
    expect(marginBps(10000, 6000)).toBe(4000);
    expect(marginBps(0, 100)).toBeNull();
  });
});
