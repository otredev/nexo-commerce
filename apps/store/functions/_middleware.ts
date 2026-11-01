/**
 * The store is a single-page app. For the pages people share (the store front and each product)
 * this puts the real title, description and image in the HTML, so links look right in WhatsApp,
 * social networks and search results. Any failure falls back to the plain page.
 */
interface Env { API: Fetcher }

const RESERVED = new Set(["api", "files", "assets"]);
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const isPage = request.method === "GET" && parts.length >= 1 && !RESERVED.has(parts[0]!) && !parts[parts.length - 1]!.includes(".");
  const response = await next();
  if (!isPage || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  try {
    const api = (path: string) => env.API.fetch(new Request(`https://api.internal/api/store/${path}`)).then((r) => (r.ok ? r.json() : null));
    const store = (await api(encodeURIComponent(parts[0]!))) as { name: string; tagline: string | null; logo: string | null } | null;
    if (!store) return response;
    let title = store.name;
    let description = store.tagline ?? `Compra en línea en ${store.name}.`;
    let image = store.logo ? `${url.origin}/files/${store.logo}` : null;
    if (parts[1] === "p" && parts[2]) {
      const product = (await api(`${encodeURIComponent(parts[0]!)}/products/${encodeURIComponent(parts[2])}`)) as { name: string; description: string | null; images: string[] } | null;
      if (product) {
        title = `${product.name} · ${store.name}`;
        if (product.description) description = product.description.slice(0, 160);
        if (product.images[0]) image = `${url.origin}/files/${product.images[0]}`;
      }
    }
    const meta = [
      `<meta property="og:url" content="${esc(url.href)}" />`,
      image ? `<meta property="og:image" content="${esc(image)}" />` : "",
      `<link rel="canonical" href="${esc(url.origin + url.pathname)}" />`,
    ].join("");
    return new HTMLRewriter()
      .on("title", { element: (el) => { el.setInnerContent(title); } })
      .on('meta[name="description"]', { element: (el) => { el.setAttribute("content", description); } })
      .on('meta[property="og:title"]', { element: (el) => { el.setAttribute("content", title); } })
      .on('meta[property="og:description"]', { element: (el) => { el.setAttribute("content", description); } })
      .on("head", { element: (el) => { el.append(meta, { html: true }); } })
      .transform(response);
  } catch {
    return response;
  }
};
