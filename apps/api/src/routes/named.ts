import { Hono } from "hono";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { tenant } from "@nexo/db";
import { namedSchema, type Named } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { toStatement } from "../lib/inventory";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { products } = tenant;

/** Categories and brands share the same shape and rules. */
function namedRoutes(table: typeof tenant.categories | typeof tenant.brands, entity: "category" | "brand", label: string) {
  const fk = entity === "category" ? products.categoryId : products.brandId;
  const duplicate = () => new AppError(409, "duplicate", `Ya existe una ${label} con ese nombre`, { name: `Ya existe una ${label} con ese nombre` });

  return new Hono<AppEnv>()
    .get("/", requirePermission("catalog:read"), async (c) => {
      const { db, tenant: t } = c.var.auth;
      const rows: Named[] = await db
        .select({
          id: table.id,
          name: table.name,
          productCount: sql<number>`(SELECT COUNT(*) FROM products p WHERE p.${sql.raw(entity === "category" ? "category_id" : "brand_id")} = ${sql.raw(entity === "category" ? "categories" : "brands")}.id AND p.deleted_at IS NULL)`,
        })
        .from(table)
        .where(eq(table.tenantId, t.id))
        .orderBy(asc(sql`${table.name} COLLATE NOCASE`));
      return c.json(rows);
    })

    .post("/", requirePermission("catalog:write"), json(namedSchema), async (c) => {
      const { name } = c.req.valid("json");
      const { db, d1, tenant: t } = c.var.auth;
      const exists = await db.select({ id: table.id }).from(table).where(and(eq(table.tenantId, t.id), sql`lower(${table.name}) = lower(${name})`)).get();
      if (exists) throw duplicate();
      const id = newId();
      await d1.batch([
        toStatement(d1, db.insert(table).values({ id, tenantId: t.id, name })),
        toStatement(d1, auditEntry(c, { action: `${entity}.create`, entity, entityId: id, after: { name } })),
      ]);
      return c.json({ id, name, productCount: 0 } satisfies Named, 201);
    })

    .put("/:id", requirePermission("catalog:write"), json(namedSchema), async (c) => {
      const { name } = c.req.valid("json");
      const id = c.req.param("id");
      const { db, d1, tenant: t } = c.var.auth;
      const current = await db.select().from(table).where(and(eq(table.id, id), eq(table.tenantId, t.id))).get();
      if (!current) throw notFound(label[0]!.toUpperCase() + label.slice(1));
      const exists = await db.select({ id: table.id }).from(table).where(and(eq(table.tenantId, t.id), ne(table.id, id), sql`lower(${table.name}) = lower(${name})`)).get();
      if (exists) throw duplicate();
      await d1.batch([
        toStatement(d1, db.update(table).set({ name }).where(and(eq(table.id, id), eq(table.tenantId, t.id)))),
        toStatement(d1, auditEntry(c, { action: `${entity}.update`, entity, entityId: id, before: { name: current.name }, after: { name } })),
      ]);
      return c.json({ id, name });
    })

    /** Deleting leaves its products without category/brand; the products are not touched otherwise. */
    .delete("/:id", requirePermission("catalog:write"), async (c) => {
      const id = c.req.param("id");
      const { db, d1, tenant: t } = c.var.auth;
      const current = await db.select().from(table).where(and(eq(table.id, id), eq(table.tenantId, t.id))).get();
      if (!current) throw notFound(label[0]!.toUpperCase() + label.slice(1));
      await d1.batch([
        toStatement(d1, db.update(products).set({ [entity === "category" ? "categoryId" : "brandId"]: null }).where(and(eq(fk, id), eq(products.tenantId, t.id)))),
        toStatement(d1, db.delete(table).where(and(eq(table.id, id), eq(table.tenantId, t.id)))),
        toStatement(d1, auditEntry(c, { action: `${entity}.delete`, entity, entityId: id, before: { name: current.name } })),
      ]);
      return c.body(null, 204);
    });
}

export const categoryRoutes = namedRoutes(tenant.categories, "category", "categoría");
export const brandRoutes = namedRoutes(tenant.brands, "brand", "marca");
