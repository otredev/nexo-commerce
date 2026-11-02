import { describe, expect, it } from "vitest";
import { clip, jsonLd, llmsTxt, productJsonLd, robotsTxt, sitemapIndex, urlset } from "./seo";

describe("seo", () => {
  it("clips at a word boundary", () => {
    expect(clip("hola mundo", 160)).toBe("hola mundo");
    const c = clip("palabra ".repeat(40), 50);
    expect(c.length).toBeLessThanOrEqual(50);
    expect(c.endsWith("…")).toBe(true);
  });
  it("builds product offers", () => {
    const one = productJsonLd({ name: "Taza", url: "https://t/p/1", description: null, images: [], sku: "T1", brand: null, category: null, currency: "MXN", lowCents: 11600, highCents: 11600, offers: 1, inStock: true }, { name: "T", url: "https://t" });
    expect(one.offers).toMatchObject({ "@type": "Offer", price: "116.00", availability: "https://schema.org/InStock" });
    const many = productJsonLd({ name: "Playera", url: "u", description: "d", images: ["i"], sku: null, brand: "B", category: "Ropa", currency: "MXN", lowCents: 20000, highCents: 25000, offers: 3, inStock: false }, { name: "T", url: "https://t" });
    expect(many.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: "200.00", highPrice: "250.00", availability: "https://schema.org/OutOfStock" });
  });
  it("inlines JSON-LD safely", () => {
    expect(jsonLd({ a: "</script><script>" })).not.toContain("</script>");
  });
  it("writes sitemaps and robots", () => {
    expect(urlset([{ loc: "https://t/a?x=1&y=2", lastmod: "2026-11-01T10:00:00Z" }])).toContain("<loc>https://t/a?x=1&amp;y=2</loc><lastmod>2026-11-01</lastmod>");
    expect(sitemapIndex([{ loc: "https://t/s/sitemap.xml" }])).toContain("<sitemapindex");
    expect(robotsTxt("https://t")).toContain("Sitemap: https://t/sitemap.xml");
  });
  it("writes llms.txt", () => {
    const t = llmsTxt({ name: "Olivo", url: "https://t/olivo", summary: "Hecho a mano", about: null, contact: ["55 1234", null], shipping: ["Recoger en tienda"], payments: ["Tarjeta"], faq: [{ q: "¿Envían?", a: "Sí" }], policies: [{ kind: "terms", url: "https://t/olivo/terminos" }], products: [{ name: "Taza", url: "https://t/olivo/p/1", price: "$116.00", description: null, available: false }], moreProducts: 2 });
    expect(t.startsWith("# Olivo\n\n> Hecho a mano")).toBe(true);
    expect(t).toContain("- [Taza](https://t/olivo/p/1): $116.00 (agotado)");
    expect(t).toContain("### ¿Envían?");
    expect(t).toContain("[Términos y condiciones](https://t/olivo/terminos)");
  });
});
