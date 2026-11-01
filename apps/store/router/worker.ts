/**
 * Router for businesses' own domains (Cloudflare for SaaS).
 * Route "*\/*" of the SaaS zone → this Worker. It forwards every request to the store's Pages project
 * and tells it which hostname the customer typed (x-nexo-host); the store resolves the business from it.
 */
interface Env {
  /** Origin of the store's Pages project, e.g. https://nexo-store.pages.dev */
  STORE_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.STORE_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("x-nexo-host", url.hostname);
    // The Pages project answers for its own hostname.
    headers.delete("host");
    const init: RequestInit = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(target.toString(), init);
  },
} satisfies ExportedHandler<Env>;
