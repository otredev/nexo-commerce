/**
 * Search engines (SEO), AI answer engines (AEO) and generative search (GEO): structured data,
 * sitemaps, robots.txt and llms.txt. Pure functions, used by the store's Pages middleware.
 */
import { escapeHtml, markdownToText, POLICY_INFO, type PolicyKind } from "./legal";

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

export const escapeXml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);

/** Collapses whitespace and cuts at a word boundary with an ellipsis. */
export function clip(text: string | null | undefined, max = SEO_DESCRIPTION_MAX): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

/** JSON for a <script type="application/ld+json">: safe to inline in HTML. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

/* ---------------- Structured data (schema.org) ---------------- */

export interface SeoStore {
  name: string;
  url: string;
  description: string | null;
  logo: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
}

export function storeJsonLd(s: SeoStore) {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": `${s.url}#store`,
    name: s.name,
    url: s.url,
    ...(s.description && { description: s.description }),
    ...(s.logo && { logo: s.logo, image: s.logo }),
    ...(s.email && { email: s.email }),
    ...(s.phone && { telephone: s.phone }),
    ...(s.address && { address: { "@type": "PostalAddress", streetAddress: s.address } }),
    currenciesAccepted: s.currency,
  };
}

export function websiteJsonLd(s: Pick<SeoStore, "name" | "url">) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: s.name,
    url: s.url,
    potentialAction: { "@type": "SearchAction", target: `${s.url}?q={search_term_string}`, "query-input": "required name=search_term_string" },
  };
}

export interface SeoProduct {
  name: string;
  url: string;
  description: string | null;
  images: string[];
  sku: string | null;
  brand: string | null;
  category: string | null;
  currency: string;
  /** Lowest and highest price shown (with taxes), in cents. */
  lowCents: number;
  highCents: number;
  offers: number;
  inStock: boolean;
}

const price = (cents: number) => (cents / 100).toFixed(2);

export function productJsonLd(p: SeoProduct, store: Pick<SeoStore, "name" | "url">) {
  const availability = p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
  const seller = { "@type": "Organization", name: store.name, url: store.url };
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    url: p.url,
    ...(p.description && { description: p.description }),
    ...(p.images.length && { image: p.images }),
    ...(p.sku && { sku: p.sku }),
    ...(p.brand && { brand: { "@type": "Brand", name: p.brand } }),
    ...(p.category && { category: p.category }),
    offers:
      p.offers > 1 && p.lowCents !== p.highCents
        ? { "@type": "AggregateOffer", priceCurrency: p.currency, lowPrice: price(p.lowCents), highPrice: price(p.highCents), offerCount: p.offers, availability, seller }
        : { "@type": "Offer", priceCurrency: p.currency, price: price(p.lowCents), availability, url: p.url, seller },
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

export function faqJsonLd(faq: Array<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

/* ---------------- Sitemaps and robots.txt ---------------- */

export interface SitemapUrl { loc: string; lastmod?: string | null }

export function urlset(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeXml(u.lastmod.slice(0, 10))}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function sitemapIndex(maps: SitemapUrl[]): string {
  const body = maps
    .map((u) => `  <sitemap><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeXml(u.lastmod.slice(0, 10))}</lastmod>` : ""}</sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/** Search engines and AI crawlers are welcome; carts, checkout and order pages are private. */
export function robotsTxt(origin: string, sitemapPath = "/sitemap.xml"): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /*/pagar",
    "Disallow: /pagar",
    "Disallow: /*/pedido/",
    "Disallow: /pedido/",
    "",
    `Sitemap: ${origin}${sitemapPath}`,
    "",
  ].join("\n");
}

/* ---------------- llms.txt (https://llmstxt.org) ---------------- */

export interface LlmsStore {
  name: string;
  url: string;
  summary: string | null;
  about: string | null;
  contact: Array<string | null>;
  shipping: string[];
  payments: string[];
  faq: Array<{ q: string; a: string }>;
  policies: Array<{ kind: PolicyKind; url: string }>;
  products: Array<{ name: string; url: string; price: string; description: string | null; available: boolean }>;
  /** More products than listed. */
  moreProducts: number;
}

export function llmsTxt(s: LlmsStore): string {
  const lines: string[] = [`# ${s.name}`, ""];
  if (s.summary) lines.push(`> ${clip(s.summary, 300)}`, "");
  if (s.about) lines.push(markdownToText(s.about), "");
  const contact = s.contact.filter(Boolean);
  lines.push("## Tienda", "", `- Tienda en línea: ${s.url}`);
  if (contact.length) lines.push(`- Contacto: ${contact.join(" · ")}`);
  if (s.shipping.length) lines.push(`- Entrega: ${s.shipping.join("; ")}`);
  if (s.payments.length) lines.push(`- Formas de pago: ${s.payments.join(", ")}`);
  lines.push("");
  if (s.products.length) {
    lines.push("## Productos", "");
    for (const p of s.products) {
      lines.push(`- [${p.name}](${p.url}): ${p.price}${p.available ? "" : " (agotado)"}${p.description ? ` — ${clip(p.description, 140)}` : ""}`);
    }
    if (s.moreProducts > 0) lines.push(`- …y ${s.moreProducts} productos más en ${s.url}`);
    lines.push("");
  }
  if (s.faq.length) {
    lines.push("## Preguntas frecuentes", "");
    for (const f of s.faq) lines.push(`### ${f.q}`, "", f.a, "");
  }
  if (s.policies.length) {
    lines.push("## Políticas", "");
    for (const p of s.policies) lines.push(`- [${POLICY_INFO[p.kind].title}](${p.url})`);
    lines.push("");
  }
  return lines.join("\n");
}

/* ---------------- Pre-rendered HTML for crawlers ---------------- */

/** Minimal readable HTML placed inside #root; React replaces it on load. */
export function staticPage(parts: { heading: string; intro?: string | null; html?: string; links?: Array<{ href: string; text: string; note?: string }> }): string {
  const links = parts.links?.length
    ? `<ul>${parts.links.map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.text)}</a>${l.note ? ` — ${escapeHtml(l.note)}` : ""}</li>`).join("")}</ul>`
    : "";
  return `<main class="st-prerender"><h1>${escapeHtml(parts.heading)}</h1>${parts.intro ? `<p>${escapeHtml(parts.intro)}</p>` : ""}${parts.html ?? ""}${links}</main>`;
}
