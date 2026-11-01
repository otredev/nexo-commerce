/** Product images and logos come from R2 through the API Worker. */
interface Env { API: Fetcher }

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
  return env.API.fetch(new Request(`https://api.internal${url.pathname}`, request));
};
