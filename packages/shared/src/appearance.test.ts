import { describe, expect, it } from "vitest";
import {
  announcementId, contrast, DEFAULT_ANNOUNCEMENT, DEFAULT_THEME, NO_PIXELS, publicAppearance, resolveTheme, safeScriptText, safeStyleText, STORE_LINK,
  THEME_PRESET_IDS, themeCss, themeTokens, themeWarnings, type StoreBanner,
} from "./appearance";
import { storeAppearanceSchema } from "./schemas";

describe("theme", () => {
  it("the untouched default adds no CSS (keeps light/dark tokens)", () => {
    expect(themeCss(DEFAULT_THEME)).toBe("");
    expect(themeCss(null)).toBe("");
  });

  it("default preset with another font only changes fonts", () => {
    const css = themeCss({ ...DEFAULT_THEME, font: "moderna" });
    expect(css).toContain("--st-heading-weight:650");
    expect(css).not.toContain("--bg");
    expect(css).not.toContain("color-scheme");
  });

  it.each(THEME_PRESET_IDS)("preset %s has readable text and buttons", (preset) => {
    const r = resolveTheme({ ...DEFAULT_THEME, preset });
    expect(themeWarnings(r)).toEqual([]);
    const t = themeTokens({ ...r, scheme: r.scheme === "auto" ? "light" : r.scheme });
    expect(contrast(t["--ink"]!, t["--bg"]!)).toBeGreaterThanOrEqual(7);
    expect(contrast(t["--ink-muted"]!, t["--bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--accent-text"]!, t["--bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--primary-ink"]!, t["--primary"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("custom colors fix the scheme by the background", () => {
    expect(resolveTheme({ ...DEFAULT_THEME, primary: "#ff0066" }).scheme).toBe("light");
    expect(resolveTheme({ ...DEFAULT_THEME, background: "#101010", text: "#f5f5f5" }).scheme).toBe("dark");
    expect(themeCss({ ...DEFAULT_THEME, background: "#101010", text: "#f5f5f5" })).toMatch(/^:root:root:root\{color-scheme:dark;/);
  });

  it("warns about unreadable combinations", () => {
    expect(themeWarnings(resolveTheme({ ...DEFAULT_THEME, background: "#ffffff", text: "#dddddd" }))).toHaveLength(1);
  });

  it("ignores values that are not colors", () => {
    expect(resolveTheme({ ...DEFAULT_THEME, primary: "red;}body{display:none" } as never).primary).toBe("#2f6b4f");
  });
});

describe("links and code", () => {
  it.each([
    ["/p/123", true], ["?categoria=abc", true], ["https://instagram.com/x", true],
    ["//evil.com", false], ["javascript:alert(1)", false], ["http://x.com", false], ["/p/1 onmouseover=x", false], ['/"><script>', false],
  ])("%s → %s", (link, ok) => expect(STORE_LINK.test(link)).toBe(ok));

  it("code cannot close its element early", () => {
    expect(safeStyleText("a{}</style><script>x</script>")).toBe("a{}<\\/style><script>x</script>");
    expect(safeScriptText("x='</SCRIPT>'; <!-- y")).toBe("x='<\\/SCRIPT>'; <\\!-- y");
  });
});

describe("public appearance", () => {
  const banner = (id: string, extra: Partial<StoreBanner> = {}): StoreBanner => ({
    id, enabled: true, image: "t/a/b.png", imageMobile: null, heading: null, text: null, cta: null, link: null, textColor: "light", align: "left", startsOn: null, endsOn: null, ...extra,
  });
  it("keeps only what is active today", () => {
    const pub = publicAppearance(
      {
        theme: DEFAULT_THEME,
        announcement: { ...DEFAULT_ANNOUNCEMENT, enabled: true, messages: [{ text: "Hola", link: null }, { text: "  ", link: null }], startsOn: "2026-11-01" },
        banners: [banner("a"), banner("b", { enabled: false }), banner("c", { startsOn: "2026-12-01" }), banner("d", { endsOn: "2026-10-31" }), banner("e", { startsOn: "2026-11-01", endsOn: "2026-11-01" })],
        pixels: NO_PIXELS,
      },
      "2026-11-01",
    );
    expect(pub.announcement?.messages).toEqual([{ text: "Hola", link: null }]);
    expect(pub.banners.map((b) => b.id)).toEqual(["a", "e"]);
    expect(publicAppearance({ theme: DEFAULT_THEME, announcement: { ...DEFAULT_ANNOUNCEMENT, enabled: true, messages: [{ text: "Hola", link: null }], endsOn: "2026-10-31" }, banners: [], pixels: NO_PIXELS }, "2026-11-01").announcement).toBeNull();
  });
  it("the announcement id changes with its text", () => {
    expect(announcementId({ messages: [{ text: "A", link: null }] })).not.toBe(announcementId({ messages: [{ text: "B", link: null }] }));
  });
});

describe("schema", () => {
  const valid = {
    theme: { preset: "fresco", primary: "#AABBCC" },
    announcement: { enabled: false, messages: [{ text: "", link: null }], tone: "primary", dismissible: true },
    banners: [],
    pixels: { metaPixelId: " 1234567890 ", googleTagId: "gtm-abcd12", tiktokPixelId: "" },
    code: { css: "" },
  };
  it("normalizes colors and pixel ids", () => {
    const r = storeAppearanceSchema.parse(valid);
    expect(r.theme.primary).toBe("#aabbcc");
    expect(r.pixels).toEqual({ metaPixelId: "1234567890", googleTagId: "GTM-ABCD12", tiktokPixelId: null });
    expect(r.code).toEqual({ css: "", headHtml: "", bodyHtml: "", js: "" });
  });
  it("rejects images outside an upload key", () => {
    const r = storeAppearanceSchema.safeParse({ ...valid, banners: [{ id: "x", enabled: true, image: "https://evil.com/a.png", textColor: "light", align: "left" }] });
    expect(r.success).toBe(false);
  });
});
