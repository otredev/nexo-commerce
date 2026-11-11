/** Customer display paired by code (Phase 8). See display.ts for the Durable Object. */
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { AppError } from "../lib/errors";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";
import { and, eq } from "drizzle-orm";
import { control, controlDb, tenant } from "@nexo/db";
import type { DisplayDevice } from "@nexo/shared";
import { stripe } from "../lib/stripe";
import { getTenantDb } from "../lib/tenant";
import { requireTerminalAccount } from "../lib/terminal";

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
    // The register's store: the display app charges cards for it (Stripe Terminal location).
    const body = (await c.req.json().catch(() => ({}))) as { locationId?: unknown };
    const locationId = typeof body.locationId === "string" && body.locationId.length <= 40 ? body.locationId : null;
    for (let i = 0; i < 6; i++) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
      const res = await call(hub(c, code), "POST", "/init", { tenantId: t.id, locationId });
      if (res.ok) return c.json({ code }, 201);
    }
    throw new AppError(503, "display_busy", "No se pudo generar un código. Intenta de nuevo.");
  })

  .post("/:code/state", requirePermission("pos:sell"), json(z.object({ state: z.record(z.string(), z.unknown()) })), async (c) => {
    const text = JSON.stringify(c.req.valid("json").state);
    if (text.length > 60_000) throw new AppError(413, "too_large", "La venta es demasiado grande para la pantalla.");
    const res = await call(hub(c, c.req.param("code")), "POST", "/state", { tenantId: c.var.auth.tenant.id, state: c.req.valid("json").state });
    if (res.status === 404) throw new AppError(404, "display_gone", "Este emparejamiento terminó. Genera un código nuevo.");
    return c.json((await res.json()) as { displays: number; device: DisplayDevice | null });
  })

  /** What the customer did on the display (sign-up, «Ya soy cliente», receipt), oldest first. Picked up once. */
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
  /**
   * Stripe Terminal connection token for the display app (Tap to Pay), scoped to the register's store.
   * The pairing code is the key, as for the rest of the display.
   */
  .post("/:code/terminal/token", async (c) => {
    const res = await call(hub(c, c.req.param("code")), "GET", "/info");
    if (res.status === 404) throw new AppError(404, "not_found", "Código no válido o vencido. Pide uno nuevo en la caja.");
    const info = (await res.json()) as { tenantId: string; locationId: string | null };
    const account = await requireTerminalAccount(c.env, info.tenantId);
    const ref = await controlDb(c.env.DB_CONTROL).select({ id: control.tenants.id, dbBinding: control.tenants.dbBinding }).from(control.tenants).where(eq(control.tenants.id, info.tenantId)).get();
    if (!ref || !info.locationId) throw new AppError(409, "terminal_location_missing", "Vuelve a emparejar la pantalla desde la caja.");
    const { db } = getTenantDb(c.env, ref);
    const loc = await db.select({ tml: tenant.locations.stripeTerminalLocationId }).from(tenant.locations).where(and(eq(tenant.locations.id, info.locationId), eq(tenant.locations.tenantId, info.tenantId))).get();
    if (!loc?.tml) throw new AppError(409, "terminal_location_missing", "Activa el cobro con tarjeta para esta tienda en Configuración › Integraciones.");
    const token = await stripe<{ secret: string }>(c.env, "POST", "/terminal/connection_tokens", { location: loc.tml }, { account });
    c.header("Cache-Control", "no-store");
    return c.json({ secret: token.secret, location: loc.tml });
  })

  .get("/:code/ws", async (c) => {
    const stub = hub(c, c.req.param("code"));
    const res = await stub.fetch("https://display/ws", { headers: { upgrade: c.req.header("upgrade") ?? "" } });
    // A Durable Object's response has immutable headers; the security-headers middleware needs to add its own.
    return new Response(res.body, { status: res.status, headers: new Headers(res.headers), webSocket: res.webSocket });
  });
