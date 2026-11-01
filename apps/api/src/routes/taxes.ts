import { Hono } from "hono";
import { and, asc, eq, ne } from "drizzle-orm";
import { taxRateSchema } from "@nexo/shared";
import { tenant } from "@nexo/db";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { taxRates } = tenant;
const columns = { id: taxRates.id, name: taxRates.name, rateBps: taxRates.rateBps, isDefault: taxRates.isDefault, active: taxRates.active };

export const taxRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db, tenant: t } = c.var.auth;
    return c.json(await db.select(columns).from(taxRates).where(eq(taxRates.tenantId, t.id)).orderBy(asc(taxRates.rateBps)));
  })

  .post("/", requirePermission("taxes:write"), json(taxRateSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, tenant: t } = c.var.auth;
    const id = newId();
    const isDefault = input.isDefault && input.active;
    await db.batch([
      db.insert(taxRates).values({ ...input, isDefault, id, tenantId: t.id }),
      auditEntry(c, { action: "tax.create", entity: "tax_rate", entityId: id, after: input }),
      ...(isDefault ? [db.update(taxRates).set({ isDefault: false }).where(and(eq(taxRates.tenantId, t.id), ne(taxRates.id, id)))] : []),
    ]);
    return c.json({ id, ...input, isDefault }, 201);
  })

  .put("/:id", requirePermission("taxes:write"), json(taxRateSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const { db, tenant: t } = c.var.auth;
    const current = await db.select(columns).from(taxRates).where(and(eq(taxRates.id, id), eq(taxRates.tenantId, t.id))).get();
    if (!current) throw notFound("Impuesto");
    if (current.isDefault && (!input.isDefault || !input.active)) {
      throw new AppError(409, "default_required", "Marca otro impuesto como predeterminado antes de quitar este.");
    }
    const changes = diff(current, input);
    await db.batch([
      db.update(taxRates).set(input).where(and(eq(taxRates.id, id), eq(taxRates.tenantId, t.id))),
      auditEntry(c, { action: "tax.update", entity: "tax_rate", entityId: id, before: changes.before, after: changes.after }),
      ...(input.isDefault ? [db.update(taxRates).set({ isDefault: false }).where(and(eq(taxRates.tenantId, t.id), ne(taxRates.id, id)))] : []),
    ]);
    return c.json({ id, ...input });
  });
