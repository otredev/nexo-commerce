import { describe, expect, it } from "vitest";
import {
  contrast, DEFAULT_ANNOUNCEMENT, DEFAULT_THEME, NO_PIXELS, resolveTheme, safeScriptText, safeStyleText, STORE_LINK,
  THEME_PRESET_IDS, themeCss, themeTokens, themeWarnings,
} from "./appearance";
import { announcementId, newBlock, publicAppearance, type BannerSlide } from "./blocks";
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
    ["/p/123", true], ["?categoria=abc", true], ["https://instagram.com/x", true], ["#horarios", true], ["tel:+52 55 1234 5678", true], ["mailto:hola@tienda.mx", true],
    ["//evil.com", false], ["javascript:alert(1)", false], ["http://x.com", false], ["/p/1 onmouseover=x", false], ['/"><script>', false],
    ["#Bad Anchor", false], ["tel:javascript:x", false], ["mailto:a@b.c?x=<y>", false], ["data:text/html,x", false],
  ])("%s → %s", (link, ok) => expect(STORE_LINK.test(link)).toBe(ok));

  it("code cannot close its element early", () => {
    expect(safeStyleText("a{}</style><script>x</script>")).toBe("a{}<\\/style><script>x</script>");
    expect(safeScriptText("x='</SCRIPT>'; <!-- y")).toBe("x='<\\/SCRIPT>'; <\\!-- y");
  });
});

describe("public appearance", () => {
  const slide = (id: string, extra: Partial<BannerSlide> = {}): BannerSlide => ({
    id, enabled: true, image: "t/a/b.png", imageMobile: null, heading: null, text: null, cta: null, link: null, textColor: "light", align: "left", startsOn: null, endsOn: null, ...extra,
  });
  it("keeps only what is active today", () => {
    const banners = newBlock("banners", "ban");
    banners.data.slides = [slide("a"), slide("b", { enabled: false }), slide("c", { startsOn: "2026-12-01" }), slide("d", { endsOn: "2026-10-31" }), slide("e", { startsOn: "2026-11-01", endsOn: "2026-11-01" })];
    const empty = newBlock("banners", "vacio");
    empty.data.slides = [slide("z", { enabled: false })];
    const hidden = { ...newBlock("text", "oculto"), enabled: false };
    const later = { ...newBlock("text", "luego"), startsOn: "2026-12-01" };
    const pub = publicAppearance(
      {
        theme: DEFAULT_THEME,
        announcement: { ...DEFAULT_ANNOUNCEMENT, enabled: true, messages: [{ text: "Hola", link: null }, { text: "  ", link: null }], startsOn: "2026-11-01" },
        blocks: [banners, empty, hidden, later, newBlock("catalog", "cat")],
        pixels: NO_PIXELS,
      },
      "2026-11-01",
    );
    expect(pub.announcement?.messages).toEqual([{ text: "Hola", link: null }]);
    expect(pub.blocks.map((b) => b.id)).toEqual(["ban", "cat"]);
    const b = pub.blocks[0]!;
    expect(b.type === "banners" && b.data.slides.map((x) => x.id)).toEqual(["a", "e"]);
    expect(publicAppearance({ theme: DEFAULT_THEME, announcement: { ...DEFAULT_ANNOUNCEMENT, enabled: true, messages: [{ text: "Hola", link: null }], endsOn: "2026-10-31" }, blocks: [], pixels: NO_PIXELS }, "2026-11-01").announcement).toBeNull();
  });
  it("the announcement id changes with its text", () => {
    expect(announcementId({ messages: [{ text: "A", link: null }] })).not.toBe(announcementId({ messages: [{ text: "B", link: null }] }));
  });
});

describe("schema", () => {
  const valid = {
    theme: { preset: "fresco", primary: "#AABBCC" },
    announcement: { enabled: false, messages: [{ text: "", link: null }], tone: "primary", dismissible: true },
    blocks: [],
    pixels: { metaPixelId: " 1234567890 ", googleTagId: "gtm-abcd12", tiktokPixelId: "" },
    code: { css: "" },
  };
  it("normalizes colors and pixel ids", () => {
    const r = storeAppearanceSchema.parse(valid);
    expect(r.theme.primary).toBe("#aabbcc");
    expect(r.pixels).toEqual({ metaPixelId: "1234567890", googleTagId: "GTM-ABCD12", tiktokPixelId: null });
    expect(r.code).toEqual({ css: "" });
  });
  it("rejects images outside an upload key", () => {
    const r = storeAppearanceSchema.safeParse({ ...valid, blocks: [{ id: "b", type: "banners", data: { slides: [{ id: "x", image: "https://evil.com/a.png" }] } }] });
    expect(r.success).toBe(false);
  });
  it("drops custom HTML and JavaScript from the code (they live in sandboxed sections now)", () => {
    const r = storeAppearanceSchema.parse({ ...valid, code: { css: "a{}", headHtml: "<script>x</script>", js: "x()" } });
    expect(r.code).toEqual({ css: "a{}" });
  });
});
