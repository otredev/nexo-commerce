import { describe, expect, it } from "vitest";
import { contrast, DEFAULT_THEME } from "./appearance";
import {
  BLOCK_TYPE_IDS, blockImages, blockListSchema, blockSchema, blockStyleVars, DEFAULT_BLOCKS, embedSrc, frameDocument, frameSandbox, newBlock,
  normalizeBlocks, openNow, parseFrameSize,
} from "./blocks";

describe("blocks: defaults and validation", () => {
  it.each(BLOCK_TYPE_IDS)("a new %s block is valid with every default", (type) => {
    const b = newBlock(type, `x-${type}`);
    expect(b.type).toBe(type);
    expect(b.enabled).toBe(true);
    expect(b.style.paddingTop).toBe("md");
    expect(blockSchema.safeParse(b).success).toBe(true);
  });

  it("fills in what a client leaves out", () => {
    const b = blockSchema.parse({ id: "h", type: "hero", data: { heading: "Hola" }, style: { background: "#AABBCC" } });
    expect(b.type === "hero" && b.data).toMatchObject({ heading: "Hola", showHeading: true, buttons: [], layout: "background" });
    expect(b.style).toMatchObject({ background: "#aabbcc", text: null, edgeBottom: "none", width: "normal" });
  });

  it("rejects bad links, ids and colors", () => {
    expect(blockSchema.safeParse({ id: "h", type: "hero", data: { buttons: [{ label: "Ir", link: "javascript:alert(1)" }] } }).success).toBe(false);
    expect(blockSchema.safeParse({ id: "con espacio", type: "text" }).success).toBe(false);
    expect(blockSchema.safeParse({ id: "t", type: "text", style: { background: "red;}" } }).success).toBe(false);
    expect(blockSchema.safeParse({ id: "t", type: "nada" }).success).toBe(false);
  });

  it("a banner button needs a link", () => {
    const r = blockSchema.safeParse({ id: "b", type: "banners", data: { slides: [{ id: "s", image: "t/x/a.png", cta: "Ver" }] } });
    expect(r.success).toBe(false);
  });

  it("the list: no repeated ids, one header and one catalog, at most 10 HTML sections", () => {
    const err = (blocks: unknown[]) => blockListSchema.safeParse(blocks).error?.issues.map((i) => i.message) ?? [];
    expect(err([{ id: "a", type: "text" }, { id: "a", type: "text" }])).toContain("Sección repetida");
    expect(err([{ id: "a", type: "catalog" }, { id: "b", type: "catalog" }]).join()).toContain("Solo puede haber una");
    expect(err(Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, type: "html" }))).join()).toContain("HTML personalizado");
    expect(err(DEFAULT_BLOCKS)).toEqual([]);
  });

  it("footer: business data on by default, https-only social links, one per store", () => {
    const f = newBlock("footer", "pie");
    expect(f.data).toMatchObject({ logo: "name", address: true, phone: true, email: true, whatsapp: true, delivery: true, policies: true, columns: [], social: [], note: null });
    const bad = (social: unknown) => blockSchema.safeParse({ id: "f", type: "footer", data: { social } }).success;
    expect(bad([{ network: "instagram", url: "https://instagram.com/vega" }])).toBe(true);
    expect(bad([{ network: "instagram", url: "http://instagram.com/vega" }])).toBe(false);
    expect(bad([{ network: "instagram", url: "javascript:alert(1)" }])).toBe(false);
    expect(bad([{ network: "myspace", url: "https://myspace.com/x" }])).toBe(false);
    const cols = blockSchema.safeParse({ id: "f", type: "footer", data: { columns: [{ title: "Ayuda", links: [{ label: "Envíos", link: "javascript:x" }] }] } });
    expect(cols.success).toBe(false);
    expect(blockSchema.safeParse({ id: "f", type: "footer", data: { columns: Array.from({ length: 5 }, () => ({ links: [] })) } }).success).toBe(false);
    const two = blockListSchema.safeParse([{ id: "a", type: "footer" }, { id: "b", type: "footer" }]);
    expect(two.error?.issues.map((i) => i.message).join()).toContain("Pie de página");
  });

  it("normalize: old rows and broken items don't take the store down", () => {
    expect(normalizeBlocks(null)).toEqual(DEFAULT_BLOCKS);
    const legacy = normalizeBlocks([
      // What migration 0012 writes from the old banners column.
      { id: "banners", type: "banners", data: { slides: [{ id: "b1", enabled: true, image: "t/x/a.png", imageMobile: null, heading: "Otoño", text: null, cta: null, link: null, textColor: "light", align: "center", startsOn: null, endsOn: null }] } },
      { id: "portada", type: "hero", data: { showHeading: false, showText: false } },
      { id: "roto", type: "gallery", data: { images: [{ image: "https://evil.com/x.png" }] } },
      { id: "catalogo", type: "catalog" },
      { id: "catalogo-2", type: "catalog" },
      { id: "html-anterior", type: "html", enabled: false, data: { html: "<p>hola</p>" } },
    ]);
    expect(legacy.map((b) => b.id)).toEqual(["banners", "portada", "catalogo", "html-anterior"]);
    expect(legacy[3]!.enabled).toBe(false);
  });

  it("lists the images each block uses", () => {
    const g = blockSchema.parse({ id: "g", type: "gallery", style: { backgroundImage: "t/x/bg.png" }, data: { images: [{ image: "t/x/1.png" }, { image: "t/x/2.png" }] } });
    expect(blockImages(g).map((i) => i.path)).toEqual(["style.backgroundImage", "data.images.0.image", "data.images.1.image"]);
  });
});

describe("custom HTML frame", () => {
  it.each([
    [{ height: 480 }, { height: "480px" }],
    [{ height: 480.6, width: 300 }, { height: "481px", width: "300px" }],
    [{ width: "50%" }, { width: "50%" }],
    [{ height: "100%" }, { height: "100vh" }],
    [{ height: "33.5%" }, { height: "33.5vh" }],
    [{ height: 0 }, { height: "0px" }],
  ])("accepts %j", (msg, css) => expect(parseFrameSize(msg)).toEqual(css));

  it.each([
    null, undefined, 480, "480", [480], {}, { height: -1 }, { height: Number.NaN }, { height: Number.POSITIVE_INFINITY }, { height: 10_001 }, { width: 4_001 },
    { height: "480px" }, { height: "101%" }, { height: "50 %" }, { height: "1e3" }, { height: "50%;background:red" }, { height: "calc(100% + 1px)" },
    { height: 100, top: 0 }, { height: 100, width: 100, x: 1 }, { type: "resize", height: 100 }, { height: { valueOf: 100 } }, { height: true }, { height: null },
    Object.create({ height: 100 }), new Map([["height", 100]]),
  ])("rejects %j", (msg) => expect(parseFrameSize(msg)).toBeNull());

  it("never allows same-origin nor top navigation", () => {
    for (const forms of [true, false]) for (const popups of [true, false]) {
      const s = frameSandbox({ forms, popups });
      expect(s).toContain("allow-scripts");
      expect(s).not.toMatch(/same-origin|top-navigation|downloads|modals/);
    }
    expect(frameSandbox({ forms: false, popups: false })).toBe("allow-scripts");
  });

  it("the document carries the theme variables and only reports its height when asked", () => {
    const doc = frameDocument("<p>Hola</p>", { autoHeight: true, vars: { "--primary": "#123456", "bad key": "x", "--x": "a}</style><script>" } });
    expect(doc).toContain("--primary:#123456");
    expect(doc).not.toContain("bad key");
    expect(doc).not.toContain("</style><script>a");
    expect(doc).toContain("parent.postMessage({height:h},'*')");
    expect(frameDocument("<p>x</p>", { autoHeight: false, vars: {} })).not.toContain("postMessage");
  });
});

describe("embeds", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "youtube", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "youtube", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "vimeo", "https://player.vimeo.com/video/76979871"],
    ["https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1", "spotify", "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M"],
    ["https://www.tiktok.com/@tienda/video/7234567890123456789", "tiktok", "https://www.tiktok.com/embed/v2/7234567890123456789"],
    ["https://www.instagram.com/p/C0abcDEF123/", "instagram", "https://www.instagram.com/p/C0abcDEF123/embed"],
    ["https://www.google.com/maps/embed?pb=!1m18", "maps", "https://www.google.com/maps/embed?pb=!1m18"],
    ["https://docs.google.com/forms/d/e/abc/viewform", "forms", "https://docs.google.com/forms/d/e/abc/viewform?embedded=true"],
  ])("%s → %s", (url, provider, src) => expect(embedSrc(url)).toMatchObject({ provider, src }));

  it("known providers keep their own origin; other pages run without it", () => {
    expect(embedSrc("https://youtu.be/dQw4w9WgXcQ")!.sandbox).toContain("allow-same-origin");
    const other = embedSrc("https://widget.ejemplo.com/reservas")!;
    expect(other.provider).toBe("other");
    expect(other.sandbox).not.toContain("allow-same-origin");
  });

  it.each(["http://youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://user:pw@ejemplo.com/", "https://www.youtube.com/watch?v=x", "data:text/html,hi", "no es url", ""])("rejects %s", (url) =>
    expect(embedSrc(url)).toBeNull());
});

describe("section colors", () => {
  it("only fonts and corners: no colors (the theme's dark mode still applies)", () => {
    const { vars, scheme } = blockStyleVars(DEFAULT_THEME, { background: null, text: null, accent: null, font: "moderna", radius: "redondo" });
    expect(scheme).toBeNull();
    expect(vars["--radius-lg"]).toBe("20px");
    expect(vars["--bg"]).toBeUndefined();
  });
  it("a dark background gets light, readable text and its own buttons", () => {
    const { vars, scheme } = blockStyleVars(DEFAULT_THEME, { background: "#101820", text: null, accent: "#ffb703", font: null, radius: null });
    expect(scheme).toBe("dark");
    expect(contrast(vars["--ink"]!, vars["--bg"]!)).toBeGreaterThanOrEqual(7);
    expect(contrast(vars["--primary-ink"]!, vars["--primary"]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("nothing set: nothing to add", () => expect(blockStyleVars(DEFAULT_THEME, { background: null, text: null, accent: null, font: null, radius: null })).toEqual({ vars: {}, scheme: null }));
});

describe("opening hours", () => {
  const week = newBlock("hours", "h").data.days; // Mon–Fri 9–18, Sat 10–14, Sun closed
  const at = (iso: string) => new Date(iso);
  it("follows the business's time zone", () => {
    // Monday 2026-11-09 16:00 UTC = 10:00 in Mexico City.
    expect(openNow(week, "America/Mexico_City", at("2026-11-09T16:00:00Z"))).toBe(true);
    // 02:00 UTC Tuesday = Monday 20:00 in Mexico City.
    expect(openNow(week, "America/Mexico_City", at("2026-11-10T02:00:00Z"))).toBe(false);
    // Sunday.
    expect(openNow(week, "America/Mexico_City", at("2026-11-08T18:00:00Z"))).toBe(false);
  });
  it("overnight ranges end the next day", () => {
    const night = week.map(() => ({ closed: false, ranges: [{ open: "20:00", close: "02:00" }] }));
    expect(openNow(night, "UTC", at("2026-11-09T21:00:00Z"))).toBe(true);
    expect(openNow(night, "UTC", at("2026-11-10T01:30:00Z"))).toBe(true);
    expect(openNow(night, "UTC", at("2026-11-10T03:00:00Z"))).toBe(false);
  });
  it("a bad time zone says closed instead of failing", () => expect(openNow(week, "Nada/Nada")).toBe(false));
});
