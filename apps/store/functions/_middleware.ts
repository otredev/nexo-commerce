/**
 * Server side of the store (Cloudflare Pages). The store itself is a single-page app; this middleware:
 * 1. On a business's own domain (tienda.minegocio.com) finds its store and tells the app, so the store
 *    lives at the root of that domain instead of under /slug.
 * 2. Answers robots.txt, sitemap.xml (an index of every store on the shared domain; the store's own list on
 *    an own domain or under /slug/sitemap.xml) and llms.txt (a plain summary for AI assistants).
 * 3. For pages (store front, products, legal pages) writes the real title, description, canonical URL,
 *    structured data (schema.org) and a readable copy of the content into the HTML, so search engines and
 *    AI crawlers that don't run JavaScript see the store. React replaces that copy when it loads.
 * Any failure falls back to the plain page.
 */
import {
  breadcrumbJsonLd, clip, faqJsonLd, formatMoney, jsonLd, llmsTxt, markdownToHtml, policyByPath, POLICY_INFO, productJsonLd, robotsTxt,
  sitemapIndex, staticPage, storeJsonLd, urlset, websiteJsonLd, escapeHtml,
  type StoreIndexEntry, type StoreInfo, type StoreProduct, type StoreProductCard,
} from "@nexo/shared";

interface Env {
  API: Fetcher;
  /** Comma-separated hostnames of the shared store domain (e.g. tienda.example.com). */
  STORE_HOSTS?: string;
  /** Google Search Console "HTML tag" verification code for the shared store domain. */
  GOOGLE_SITE_VERIFICATION?: string;
}

const RESERVED = new Set(["api", "files", "assets"]);
const PRIVATE = new Set(["pagar", "pedido"]);

/** Hostname the customer typed. The SaaS router Worker passes it in x-nexo-host. */
const visibleHost = (request: Request) => (request.headers.get("x-nexo-host") ?? new URL(request.url).hostname).toLowerCase();

function isSharedHost(host: string, env: Env) {
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".pages.dev")) return true;
  return (env.STORE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
}

const text = (body: string, type: string, maxAge = 3600) =>
  new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": `public, max-age=${maxAge}` } });

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const parts = url.pathname.split("/").filter(Boolean);
  if (RESERVED.has(parts[0] ?? "")) return next();

  const api = async <T,>(path: string): Promise<T | null> => {
    try {
      const r = await env.API.fetch(new Request(`https://api.internal/api/${path}`));
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };

  const host = visibleHost(request);
  const shared = isSharedHost(host, env);
  const publicOrigin = request.headers.get("x-nexo-host") ? `https://${host}` : url.origin;

  // Which store this request belongs to, and the rest of the path inside it.
  let slug: string | null = null;
  let rest = parts;
  if (!shared) slug = (await api<{ slug: string }>(`store-host/${encodeURIComponent(host)}`))?.slug ?? null;
  const ownDomain = Boolean(slug);

  let response: Response | null = null;
  try {
    /* ---------- Files at the root ---------- */
    if (parts.length === 1 && parts[0] === "robots.txt") return text(robotsTxt(publicOrigin), "text/plain");
    if (!ownDomain && parts.length === 1 && parts[0] === "sitemap.xml") {
      const stores = (await api<StoreIndexEntry[]>("store-index")) ?? [];
      // Stores with their own domain are submitted there (a sitemap only lists URLs of its own host).
      return text(sitemapIndex(stores.filter((s) => !s.domain).map((s) => ({ loc: `${publicOrigin}/${s.slug}/sitemap.xml`, lastmod: s.updatedAt }))), "application/xml");
    }
    if (!ownDomain && parts.length === 1 && parts[0] === "llms.txt") {
      const stores = (await api<StoreIndexEntry[]>("store-index")) ?? [];
      const lines = ["# Tiendas", "", "> Tiendas en línea creadas con Nexo. Cada una tiene su propio resumen en llms.txt.", "", "## Tiendas", ""];
      for (const s of stores) {
        const home = s.domain ? `https://${s.domain}` : `${publicOrigin}/${s.slug}`;
        lines.push(`- [${s.domain ?? s.slug}](${home}): resumen en ${home}/llms.txt`);
      }
      return text(lines.join("\n") + "\n", "text/plain");
    }

    if (!slug) {
      if (!parts.length) {
        // Home of the shared domain: only the Search Console verification tag, if configured.
        const home = await next();
        if (!env.GOOGLE_SITE_VERIFICATION || !(home.headers.get("content-type") ?? "").includes("text/html")) return home;
        const tag = `<meta name="google-site-verification" content="${escapeHtml(env.GOOGLE_SITE_VERIFICATION)}" />`;
        return new HTMLRewriter().on("head", { element: (el) => { el.prepend(tag, { html: true }); } }).transform(home);
      }
      slug = parts[0]!.toLowerCase();
      rest = parts.slice(1);
    }
    const last = rest[rest.length - 1] ?? "";
    const isFile = last.includes(".");
    if (isFile && !(rest.length === 1 && (last === "sitemap.xml" || last === "llms.txt"))) return next();

    const store = await api<StoreInfo>(`store/${encodeURIComponent(slug)}`);
    if (!store) return next();
    const base = ownDomain ? publicOrigin : `${publicOrigin}/${store.slug}`;
    // Canonical address: the store's own domain when it has one.
    const canonicalBase = store.domain ? `https://${store.domain}` : base;
    const fileUrl = (key: string | null) => (key ? `${publicOrigin}/files/${key}` : null);
    const money = (cents: number) => formatMoney(cents, store.currency, store.locale);

    /* ---------- Store files ---------- */
    if (rest.length === 1 && last === "sitemap.xml") {
      if (!store.indexable || (!ownDomain && store.domain)) return new Response("Not found", { status: 404 });
      const data = await api<{ updatedAt: string; products: Array<{ id: string; updatedAt: string }>; policies: Array<{ kind: keyof typeof POLICY_INFO; updatedAt: string }> }>(`store/${encodeURIComponent(store.slug)}/sitemap`);
      if (!data) return next();
      const newest = [data.updatedAt, ...data.products.map((p) => p.updatedAt)].sort().pop();
      return text(
        urlset([
          { loc: ownDomain ? `${base}/` : base, lastmod: newest },
          ...data.products.map((p) => ({ loc: `${base}/p/${p.id}`, lastmod: p.updatedAt })),
          ...data.policies.map((p) => ({ loc: `${base}/${POLICY_INFO[p.kind].path}`, lastmod: p.updatedAt })),
        ]),
        "application/xml",
        600,
      );
    }
    if (rest.length === 1 && last === "llms.txt") {
      const list = await api<{ items: StoreProductCard[]; total: number }>(`store/${encodeURIComponent(store.slug)}/products?pageSize=60`);
      const items = list?.items ?? [];
      return text(
        llmsTxt({
          name: store.name,
          url: canonicalBase,
          summary: store.seoDescription ?? store.tagline,
          about: store.about,
          contact: [store.phone, store.email, store.whatsapp ? `WhatsApp ${store.whatsapp}` : null, store.address],
          shipping: [store.pickupEnabled ? "Recoger en tienda" : null, store.deliveryEnabled ? `Envío a domicilio${store.deliveryArea ? ` (${store.deliveryArea})` : ""}` : null].filter(Boolean) as string[],
          payments: [store.payOnDelivery ? "Pago al recibir" : null, store.transferEnabled ? "Transferencia" : null, store.cardEnabled ? "Tarjeta" : null].filter(Boolean) as string[],
          faq: store.faq,
          policies: store.policies.map((p) => ({ kind: p.kind, url: `${canonicalBase}/${POLICY_INFO[p.kind].path}` })),
          products: items.map((p) => ({ name: p.name, url: `${canonicalBase}/p/${p.id}`, price: `${p.priceVaries ? "desde " : ""}${money(p.fromPriceCents)}`, description: null, available: !p.soldOut })),
          moreProducts: Math.max((list?.total ?? 0) - items.length, 0),
        }),
        "text/plain",
        600,
      );
    }

    /* ---------- Pages ---------- */
    response = await next();
    if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
    const isPrivate = PRIVATE.has(rest[0] ?? "");
    const description0 = store.seoDescription ?? store.tagline ?? clip(store.about) ?? `Compra en línea en ${store.name}.`;
    let title = store.seoTitle ?? (store.tagline ? `${store.name} · ${store.tagline}` : store.name);
    let description = description0 || `Compra en línea en ${store.name}.`;
    let image = fileUrl(store.logo);
    let canonical: string = canonicalBase + (ownDomain || store.domain ? "/" : "");
    const ld: unknown[] = [];
    let body = "";
    const storeLd = { name: store.name, url: canonicalBase, description, logo: fileUrl(store.logo), email: store.email, phone: store.phone, address: store.address, currency: store.currency };

    if (rest.length === 0) {
      const list = await api<{ items: StoreProductCard[]; total: number }>(`store/${encodeURIComponent(store.slug)}/products?pageSize=48`);
      ld.push(storeJsonLd(storeLd), websiteJsonLd(storeLd));
      if (store.faq.length) ld.push(faqJsonLd(store.faq));
      const faqHtml = store.faq.length ? `<h2>Preguntas frecuentes</h2>${store.faq.map((f) => `<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`).join("")}` : "";
      body = staticPage({
        heading: store.name,
        intro: store.tagline,
        html: (store.about ? markdownToHtml(store.about) : "") + faqHtml,
        links: [
          ...(list?.items ?? []).map((p) => ({ href: `${base}/p/${p.id}`, text: p.name, note: `${p.priceVaries ? "desde " : ""}${money(p.fromPriceCents)}${p.soldOut ? " · agotado" : ""}` })),
          ...store.policies.map((p) => ({ href: `${base}/${POLICY_INFO[p.kind].path}`, text: POLICY_INFO[p.kind].title })),
        ],
      });
    } else if (rest[0] === "p" && rest[1]) {
      const p = await api<StoreProduct>(`store/${encodeURIComponent(store.slug)}/products/${encodeURIComponent(rest[1])}`);
      if (p) {
        const prices = p.variants.map((v) => (p.promotion ? v.displayPriceCents - Math.round((v.displayPriceCents * p.promotion.percentBps) / 10_000) : v.displayPriceCents));
        const low = Math.min(...prices);
        const high = Math.max(...prices);
        const url = `${canonicalBase}/p/${p.id}`;
        title = p.seoTitle ?? `${p.name} · ${store.name}`;
        description = p.seoDescription ?? (p.description ? clip(p.description) : `${p.name} en ${store.name}: ${money(low)}.`);
        if (p.images[0]) image = fileUrl(p.images[0]);
        canonical = url;
        ld.push(
          productJsonLd(
            {
              name: p.name, url, description: p.description, images: p.images.map((k) => fileUrl(k)!), sku: p.variants.length === 1 ? p.variants[0]!.sku || null : null,
              brand: p.brandName, category: p.categoryName, currency: store.currency, lowCents: low, highCents: high, offers: p.variants.length,
              inStock: p.variants.some((v) => v.available === null || v.available > 0),
            },
            storeLd,
          ),
          breadcrumbJsonLd([
            { name: store.name, url: canonicalBase },
            ...(p.categoryName && p.categoryId ? [{ name: p.categoryName, url: `${canonicalBase}?categoria=${p.categoryId}` }] : []),
            { name: p.name, url },
          ]),
        );
        body = staticPage({
          heading: p.name,
          intro: `${low !== high ? "Desde " : ""}${money(low)}${p.brandName ? ` · ${p.brandName}` : ""}`,
          html: p.description ? `<p>${escapeHtml(p.description).replace(/\n/g, "<br>")}</p>` : "",
          links: [{ href: base, text: `Ver todo en ${store.name}` }],
        });
      }
    } else if (rest.length === 1 && policyByPath(rest[0]!)) {
      const kind = policyByPath(rest[0]!)!;
      const page = await api<{ content: string; updatedAt: string }>(`store/${encodeURIComponent(store.slug)}/policies/${kind}`);
      if (page) {
        title = `${POLICY_INFO[kind].title} · ${store.name}`;
        description = clip(page.content.replace(/[#*[\]()]/g, " "));
        canonical = `${canonicalBase}/${POLICY_INFO[kind].path}`;
        body = staticPage({ heading: POLICY_INFO[kind].title, html: markdownToHtml(page.content.replace(/\]\(\/(?!\/)/g, `](${base}/`)) });
      }
    }

    const noindex = !store.indexable || isPrivate;
    const head = [
      ownDomain ? `<script>window.__NX_STORE__=${JSON.stringify({ slug: store.slug }).replace(/</g, "\\u003c")}</script>` : "",
      `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
      `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
      `<meta property="og:site_name" content="${escapeHtml(store.name)}" />`,
      image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
      `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
      noindex ? `<meta name="robots" content="noindex" />` : "",
      ...ld.map((d) => `<script type="application/ld+json">${jsonLd(d)}</script>`),
    ].join("");

    return new HTMLRewriter()
      .on("title", { element: (el) => { el.setInnerContent(title); } })
      .on('meta[name="description"]', { element: (el) => { el.setAttribute("content", description); } })
      .on('meta[property="og:title"]', { element: (el) => { el.setAttribute("content", title); } })
      .on('meta[property="og:description"]', { element: (el) => { el.setAttribute("content", description); } })
      .on('meta[property="og:type"]', { element: (el) => { el.setAttribute("content", rest[0] === "p" ? "product" : "website"); } })
      .on("head", { element: (el) => { el.prepend(head, { html: true }); } })
      .on("#root", { element: (el) => { if (body && !isPrivate) el.setInnerContent(body, { html: true }); } })
      .transform(response);
  } catch {
    return response ?? next();
  }
};
