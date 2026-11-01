import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { control, controlDb, tenant } from "@nexo/db";
import { businessSettingsSchema } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { notFound } from "../lib/errors";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { businessSettings } = tenant;

export const settingsRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("settings:read"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const row = await db.select().from(businessSettings).where(eq(businessSettings.tenantId, t.id)).get();
    if (!row) throw notFound("Configuración");
    const { tenantId: _, ...settings } = row;
    return c.json(settings);
  })

  .put("/", requirePermission("settings:write"), json(businessSettingsSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, tenant: t } = c.var.auth;
    const current = await db.select().from(businessSettings).where(eq(businessSettings.tenantId, t.id)).get();
    if (!current) throw notFound("Configuración");

    const changes = diff(current, input);
    if (!changes.changed) {
      const { tenantId: _, ...settings } = current;
      return c.json(settings);
    }
    const updatedAt = new Date().toISOString();
    await db.batch([
      db.update(businessSettings).set({ ...input, updatedAt }).where(eq(businessSettings.tenantId, t.id)),
      auditEntry(c, { action: "settings.update", entity: "business_settings", entityId: t.id, before: changes.before, after: changes.after }),
    ]);
    // Keep the business name shown in the control DB in sync.
    if (input.tradeName !== current.tradeName) {
      await controlDb(c.env.DB_CONTROL).update(control.tenants).set({ name: input.tradeName }).where(eq(control.tenants.id, t.id));
    }
    return c.json({ ...input, updatedAt });
  });
