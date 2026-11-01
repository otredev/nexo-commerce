/**
 * Only the public store API is reachable from the store's domain; the dashboard API is not.
 * Requests go to the API Worker through the service binding.
 */
interface Env { API: Fetcher }

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/store/")) {
    return Response.json({ error: { code: "not_found", message: "Ruta no encontrada" } }, { status: 404 });
  }
  return env.API.fetch(new Request(`https://api.internal${url.pathname}${url.search}`, request));
};
