import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { AppError } from "../lib/errors";

/**
 * CSRF protection for cookie sessions: state-changing requests must come from our own origin.
 * Complements SameSite=Lax on the session cookie.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  // The public store API uses no cookies (nothing to forge) and is called from the store's own domain.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !new URL(c.req.url).pathname.startsWith("/api/store/")) {
    const origin = c.req.header("origin");
    const self = new URL(c.req.url).origin;
    const allowed = new Set([self, new URL(c.env.APP_URL).origin]);
    if (origin && !allowed.has(origin)) {
      throw new AppError(403, "bad_origin", "Origen no permitido");
    }
  }
  await next();
});
