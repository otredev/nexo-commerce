/** Customer display paired by code (Phase 8). See display.ts for the Durable Object. */
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { AppError } from "../lib/errors";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const CODE = /^\d{6}$/;

function hub(c: Context<AppEnv>, code: string) {
  if (!c.env.DISPLAY_HUB) throw new AppError(503, "display_unavailable", "La pantalla en otro dispositivo no está disponible en este entorno.");
  if (!CODE.test(code)) throw new AppError(404, "not_found", "Código no válido");
  return c.env.DISPLAY_HUB.get(c.env.DISPLAY_HUB.idFromName(code));
}

const call = (stub: DurableObjectStub, method: string, path: string, body?: unknown) =>
  stub.fetch(`https://display${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });

/** For the register (signed in, pos:sell). */
export const posDisplayRoutes = new Hono<AppEnv>()
  .post("/", requirePermission("pos:sell"), async (c) => {
    const { tenant: t } = c.var.auth;
    for (let i = 0; i < 6; i++) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
      const res = await call(hub(c, code), "POST", "/init", { tenantId: t.id });
      if (res.ok) return c.json({ code }, 201);
    }
    throw new AppError(503, "display_busy", "No se pudo generar un código. Intenta de nuevo.");
  })

  .post("/:code/state", requirePermission("pos:sell"), json(z.object({ state: z.record(z.string(), z.unknown()) })), async (c) => {
    const text = JSON.stringify(c.req.valid("json").state);
    if (text.length > 60_000) throw new AppError(413, "too_large", "La venta es demasiado grande para la pantalla.");
    const res = await call(hub(c, c.req.param("code")), "POST", "/state", { tenantId: c.var.auth.tenant.id, state: c.req.valid("json").state });
    if (res.status === 404) throw new AppError(404, "display_gone", "Este emparejamiento terminó. Genera un código nuevo.");
    return c.json((await res.json()) as { displays: number });
  })

  /** The customer's answer to "¿Quieres registrarte?" (or null). Picked up once. */
  .get("/:code/inbox", requirePermission("pos:sell"), async (c) => {
    const res = await call(hub(c, c.req.param("code")), "GET", `/inbox?tenantId=${encodeURIComponent(c.var.auth.tenant.id)}`);
    if (res.status === 404) throw new AppError(404, "display_gone", "Este emparejamiento terminó. Genera un código nuevo.");
    c.header("Cache-Control", "no-store");
    return c.json(await res.json());
  })

  .delete("/:code", requirePermission("pos:sell"), async (c) => {
    await call(hub(c, c.req.param("code")), "DELETE", `/?tenantId=${encodeURIComponent(c.var.auth.tenant.id)}`);
    return c.body(null, 204);
  });

/** For the display (no sign-in; the code is the key). */
export const publicDisplayRoutes = new Hono<AppEnv>()
  .get("/:code", async (c) => {
    const res = await call(hub(c, c.req.param("code")), "GET", "/state");
    if (res.status === 404) throw new AppError(404, "not_found", "Código no válido o vencido. Pide uno nuevo en la caja.");
    c.header("Cache-Control", "no-store");
    return c.json(await res.json());
  })
  .get("/:code/ws", async (c) => {
    const stub = hub(c, c.req.param("code"));
    const res = await stub.fetch("https://display/ws", { headers: { upgrade: c.req.header("upgrade") ?? "" } });
    // A Durable Object's response has immutable headers; the security-headers middleware needs to add its own.
    return new Response(res.body, { status: res.status, headers: new Headers(res.headers), webSocket: res.webSocket });
  });
