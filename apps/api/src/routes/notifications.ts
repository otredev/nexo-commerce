/** Push notifications of the signed-in person: devices, preferences and a test (Phase 8). */
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { can, deviceLabel, NOTIFICATION_EVENTS, notificationPrefsSchema, pushSubscribeSchema, type NotificationSettings } from "@nexo/shared";
import type { AppEnv } from "../env";
import { allowed } from "../middleware/auth";
import { newId } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { notify, pushConfigured } from "../lib/notify";
import { json } from "../lib/validate";

export const notificationRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { user, tenant: t, role } = c.var.auth;
    const db = controlDb(c.env.DB_CONTROL);
    const [prefsRow, devices] = await Promise.all([
      db.select().from(control.notificationPrefs).where(and(eq(control.notificationPrefs.userId, user.id), eq(control.notificationPrefs.tenantId, t.id))).get(),
      db
        .select({ id: control.pushSubscriptions.id, device: control.pushSubscriptions.device, createdAt: control.pushSubscriptions.createdAt, lastSentAt: control.pushSubscriptions.lastSentAt })
        .from(control.pushSubscriptions)
        .where(and(eq(control.pushSubscriptions.userId, user.id), eq(control.pushSubscriptions.tenantId, t.id)))
        .orderBy(desc(control.pushSubscriptions.createdAt)),
    ]);
    const body: NotificationSettings = {
      available: pushConfigured(c.env),
      publicKey: c.env.VAPID_PUBLIC_KEY ?? null,
      events: NOTIFICATION_EVENTS.filter((e) => allowed(c.var.auth, e.permission)).map((e) => ({ id: e.id, label: e.label, help: e.help, enabled: prefsRow?.prefs[e.id] !== false })),
      devices,
    };
    return c.json(body);
  })

  /** Registers this browser. The same endpoint moves to whoever subscribed last (shared devices). */
  .post("/subscriptions", json(pushSubscribeSchema), async (c) => {
    const { endpoint, keys } = c.req.valid("json");
    if (!pushConfigured(c.env)) throw new AppError(503, "push_not_configured", "Las notificaciones aún no están disponibles en la plataforma.");
    if (!endpoint.startsWith("https://") && c.env.APP_ENV !== "development") throw new AppError(422, "validation_error", "Suscripción no válida");
    const { user, tenant: t } = c.var.auth;
    const db = controlDb(c.env.DB_CONTROL);
    const id = newId();
    const device = deviceLabel(c.req.header("user-agent") ?? "");
    await db
      .insert(control.pushSubscriptions)
      .values({ id, userId: user.id, tenantId: t.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, device })
      .onConflictDoUpdate({ target: control.pushSubscriptions.endpoint, set: { userId: user.id, tenantId: t.id, p256dh: keys.p256dh, auth: keys.auth, device, failures: 0 } });
    const row = (await db.select({ id: control.pushSubscriptions.id }).from(control.pushSubscriptions).where(eq(control.pushSubscriptions.endpoint, endpoint)).get())!;
    return c.json({ id: row.id, device }, 201);
  })

  .delete("/subscriptions/:id", async (c) => {
    const { user } = c.var.auth;
    await controlDb(c.env.DB_CONTROL).delete(control.pushSubscriptions).where(and(eq(control.pushSubscriptions.id, c.req.param("id")), eq(control.pushSubscriptions.userId, user.id)));
    return c.body(null, 204);
  })

  /** This browser unsubscribed itself (by endpoint, it does not know the id). */
  .post("/subscriptions/remove", json(pushSubscribeSchema.pick({ endpoint: true })), async (c) => {
    const { user } = c.var.auth;
    await controlDb(c.env.DB_CONTROL).delete(control.pushSubscriptions).where(and(eq(control.pushSubscriptions.endpoint, c.req.valid("json").endpoint), eq(control.pushSubscriptions.userId, user.id)));
    return c.body(null, 204);
  })

  .put("/prefs", json(notificationPrefsSchema), async (c) => {
    const { user, tenant: t } = c.var.auth;
    const allowed = new Set<string>(NOTIFICATION_EVENTS.map((e) => e.id));
    const prefs = Object.fromEntries(Object.entries(c.req.valid("json").prefs).filter(([k]) => allowed.has(k)));
    const now = new Date().toISOString();
    await controlDb(c.env.DB_CONTROL)
      .insert(control.notificationPrefs)
      .values({ userId: user.id, tenantId: t.id, prefs, updatedAt: now })
      .onConflictDoUpdate({ target: [control.notificationPrefs.userId, control.notificationPrefs.tenantId], set: { prefs, updatedAt: now } });
    return c.json({ prefs });
  })

  .post("/test", async (c) => {
    const { user, tenant: t } = c.var.auth;
    if (!pushConfigured(c.env)) throw new AppError(503, "push_not_configured", "Las notificaciones aún no están disponibles en la plataforma.");
    const sent = await notify(c.env, t.id, "test", { title: "Notificaciones activadas", body: `Así te avisaremos de lo importante en ${t.name}.`, url: "/configuracion?tab=notificaciones", tag: "test" }, { userId: user.id });
    if (!sent) throw new AppError(409, "no_devices", "No se pudo enviar a ningún dispositivo. Activa las notificaciones en este navegador.");
    return c.json({ sent });
  });
