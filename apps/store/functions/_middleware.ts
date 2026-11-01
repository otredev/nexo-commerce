/**
 * The store is a single-page app. This middleware:
 * 1. On a business's own domain (tienda.minegocio.com) finds its store and tells the app, so the store
 *    lives at the root of that domain instead of under /slug.
 * 2. For the pages people share (store front and each product) puts the real title, description and image
 *    in the HTML, so links look right in WhatsApp, social networks and search results.
 * Any failure falls back to the plain page.
 */
interface Env {
  API: Fetcher;
  /** Comma-separated hostnames of the shared store domain (e.g. tienda.example.com). */
  STORE_HOSTS?: string;
}

const RESERVED = new Set(["api", "files", "assets"]);
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** Hostname the customer typed. The SaaS router Worker passes it in x-nexo-host. */
const visibleHost = (request: Request) => (request.headers.get("x-nexo-host") ?? new URL(request.url).hostname).toLowerCase();

function isSharedHost(host: string, env: Env) {
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".pages.dev")) return true;
  return (env.STORE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const isPage = request.method === "GET" && !RESERVED.has(parts[0] ?? "") && !(parts[parts.length - 1] ?? "").includes(".");
  if (!isPage) return next();
  const response = await next();
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  try {
    const api = (path: string) => env.API.fetch(new Request(`https://api.internal/api/${path}`)).then((r) => (r.ok ? r.json() : null));
    const host = visibleHost(request);
    let slug: string | null = null;
    let rest = parts;
    if (!isSharedHost(host, env)) {
      slug = ((await api(`store-host/${encodeURIComponent(host)}`)) as { slug: string } | null)?.slug ?? null;
    }
    const ownDomain = Boolean(slug);
    if (!slug) {
      if (!parts.length) return response;
      slug = parts[0]!;
      rest = parts.slice(1);
    }
    const store = (await api(`store/${encodeURIComponent(slug)}`)) as { name: string; tagline: string | null; logo: string | null } | null;
    if (!store) return response;
    const origin = ownDomain ? `https://${host}` : url.origin;
    let title = store.name;
    let description = store.tagline ?? `Compra en línea en ${store.name}.`;
    let image = store.logo ? `${origin}/files/${store.logo}` : null;
    if (rest[0] === "p" && rest[1]) {
      const product = (await api(`store/${encodeURIComponent(slug)}/products/${encodeURIComponent(rest[1])}`)) as { name: string; description: string | null; images: string[] } | null;
      if (product) {
        title = `${product.name} · ${store.name}`;
        if (product.description) description = product.description.slice(0, 160);
        if (product.images[0]) image = `${origin}/files/${product.images[0]}`;
      }
    }
    const meta = [
      ownDomain ? `<script>window.__NX_STORE__=${JSON.stringify({ slug }).replace(/</g, "\\u003c")}</script>` : "",
      `<meta property="og:url" content="${esc(origin + url.pathname)}" />`,
      image ? `<meta property="og:image" content="${esc(image)}" />` : "",
      `<link rel="canonical" href="${esc(origin + url.pathname)}" />`,
    ].join("");
    return new HTMLRewriter()
      .on("title", { element: (el) => { el.setInnerContent(title); } })
      .on('meta[name="description"]', { element: (el) => { el.setAttribute("content", description); } })
      .on('meta[property="og:title"]', { element: (el) => { el.setAttribute("content", title); } })
      .on('meta[property="og:description"]', { element: (el) => { el.setAttribute("content", description); } })
      .on("head", { element: (el) => { el.prepend(meta, { html: true }); } })
      .transform(response);
  } catch {
    return response;
  }
};
