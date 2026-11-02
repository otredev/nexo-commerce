import { describe, expect, it } from "vitest";
import { changePct, daysBetween, localDayStart, localRange, shiftDay, sourceLabel, tzOffsetMinutes } from "./analytics";

describe("dates", () => {
  it("counts days inclusively", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(31);
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(1);
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds where a local day starts in UTC", () => {
    expect(localDayStart("2026-11-02", "America/Mexico_City").toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(localDayStart("2026-07-01", "Europe/Madrid").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    // New York on the day DST ends: midnight is still EDT (UTC-4).
    expect(localDayStart("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    const [s, e] = localRange("2026-11-01", "2026-11-01", "America/New_York");
    expect((e.getTime() - s.getTime()) / 3_600_000).toBe(25);
  });
  it("offset of an unknown zone is 0", () => {
    expect(tzOffsetMinutes("Nowhere/City", new Date())).toBe(0);
  });
});

describe("sources and changes", () => {
  it.each([
    ["", "Directo o desconocido"], ["google.com.mx", "Google"], ["l.instagram.com", "Instagram"], ["lm.facebook.com", "Facebook"],
    ["t.co", "X (Twitter)"], ["wa.me", "WhatsApp"], ["chatgpt.com", "ChatGPT"], ["blog.ejemplo.mx", "blog.ejemplo.mx"],
  ])("%s → %s", (host, label) => expect(sourceLabel(host)).toBe(label));
  it("percent change", () => {
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(5, 0)).toBeNull();
  });
});
