import { Hono } from "hono";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { locationSchema } from "@nexo/shared";
import { tenant } from "@nexo/db";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { newId } from "../lib/crypto";
import { assertWithinLimit } from "../lib/plan";
import { AppError, notFound } from "../lib/errors";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { locations } = tenant;
const columns = { id: locations.id, name: locations.name, type: locations.type, address: locations.address, isDefault: locations.isDefault, active: locations.active };

const isUniqueViolation = (err: unknown) => String((err as Error)?.message ?? err).includes("UNIQUE");

export const locationRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db, tenant: t } = c.var.auth;
    return c.json(await db.select(columns).from(locations).where(eq(locations.tenantId, t.id)).orderBy(desc(locations.isDefault), asc(locations.name)));
  })

  .post("/", requirePermission("locations:write"), json(locationSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, tenant: t } = c.var.auth;
    const id = newId();
    if (input.active) await assertWithinLimit(c, "locations");
    const isDefault = input.isDefault && input.active;
    try {
      await db.batch([
        db.insert(locations).values({ ...input, isDefault, id, tenantId: t.id }),
        auditEntry(c, { action: "location.create", entity: "location", entityId: id, after: input }),
        ...(isDefault ? [db.update(locations).set({ isDefault: false }).where(and(eq(locations.tenantId, t.id), ne(locations.id, id)))] : []),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, "duplicate", "Ya existe una ubicación con ese nombre", { name: "Ya existe una ubicación con ese nombre" });
      throw err;
    }
    return c.json({ id, ...input, isDefault }, 201);
  })

  .put("/:id", requirePermission("locations:write"), json(locationSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const { db, tenant: t } = c.var.auth;
    const current = await db.select(columns).from(locations).where(and(eq(locations.id, id), eq(locations.tenantId, t.id))).get();
    if (!current) throw notFound("Ubicación");
    if (current.isDefault && (!input.isDefault || !input.active)) {
      throw new AppError(409, "default_required", "Marca otra ubicación como principal antes de cambiar esta.");
    }
    if (!current.active && input.active) await assertWithinLimit(c, "locations");
    const changes = diff(current, input);
    try {
      await db.batch([
        db.update(locations).set(input).where(and(eq(locations.id, id), eq(locations.tenantId, t.id))),
        auditEntry(c, { action: "location.update", entity: "location", entityId: id, before: changes.before, after: changes.after }),
        ...(input.isDefault ? [db.update(locations).set({ isDefault: false }).where(and(eq(locations.tenantId, t.id), ne(locations.id, id)))] : []),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, "duplicate", "Ya existe una ubicación con ese nombre", { name: "Ya existe una ubicación con ese nombre" });
      throw err;
    }
    return c.json({ id, ...input });
  });
