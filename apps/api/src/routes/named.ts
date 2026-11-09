import { Hono } from "hono";
import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import { tenant } from "@nexo/db";
import { categorySchema, namedSchema, type CategoryItem, type Named } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { toStatement } from "../lib/inventory";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { products, categories } = tenant;

/** Brands: just a name. (Categories add one level of subcategories, below.) */
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

export const brandRoutes = namedRoutes(tenant.brands, "brand", "marca");

/* ---------- Categories and subcategories ---------- */

const catError = (field: string, message: string) => new AppError(422, "validation_error", "Revisa los campos marcados", { [field]: message });
const catDuplicate = (sub: boolean) =>
  new AppError(409, "duplicate", sub ? "Esa categoría ya tiene una subcategoría con ese nombre" : "Ya existe una categoría con ese nombre", {
    name: sub ? "Ya hay una subcategoría con ese nombre aquí" : "Ya existe una categoría con ese nombre",
  });

export const categoryRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("catalog:read"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const rows: CategoryItem[] = await db
      .select({
        id: categories.id,
        name: categories.name,
        parentId: categories.parentId,
        productCount: sql<number>`(SELECT COUNT(*) FROM products p WHERE p.category_id = "categories"."id" AND p.deleted_at IS NULL)`,
      })
      .from(categories)
      .where(eq(categories.tenantId, t.id))
      .orderBy(asc(sql`${categories.name} COLLATE NOCASE`));
    return c.json(rows);
  })

  .post("/", requirePermission("catalog:write"), json(categorySchema), async (c) => {
    const { name, parentId } = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const parent = parentId ? await validParent(c, parentId, null) : null;
    const exists = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, t.id), parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId), sql`lower(${categories.name}) = lower(${name})`))
      .get();
    if (exists) throw catDuplicate(Boolean(parentId));
    const id = newId();
    await d1.batch([
      toStatement(d1, db.insert(categories).values({ id, tenantId: t.id, name, parentId })),
      toStatement(d1, auditEntry(c, { action: "category.create", entity: "category", entityId: id, after: { name, parent: parent?.name ?? null } })),
    ]);
    return c.json({ id, name, parentId, productCount: 0 } satisfies CategoryItem, 201);
  })

  .put("/:id", requirePermission("catalog:write"), json(categorySchema), async (c) => {
    const { name, parentId } = c.req.valid("json");
    const id = c.req.param("id");
    const { db, d1, tenant: t } = c.var.auth;
    const current = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.tenantId, t.id))).get();
    if (!current) throw notFound("Categoría");
    const parent = parentId ? await validParent(c, parentId, id) : null;
    if (parentId) {
      const [kids] = await db.select({ n: count() }).from(categories).where(and(eq(categories.tenantId, t.id), eq(categories.parentId, id)));
      if (kids?.n) throw catError("parentId", "Tiene subcategorías: no puede ser subcategoría de otra");
    }
    const exists = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, t.id), ne(categories.id, id), parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId), sql`lower(${categories.name}) = lower(${name})`))
      .get();
    if (exists) throw catDuplicate(Boolean(parentId));
    await d1.batch([
      toStatement(d1, db.update(categories).set({ name, parentId }).where(and(eq(categories.id, id), eq(categories.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: "category.update", entity: "category", entityId: id, before: { name: current.name, parentId: current.parentId }, after: { name, parentId, parent: parent?.name ?? null } })),
    ]);
    return c.json({ id, name, parentId });
  })

  /** Leaves its products without category. A category with subcategories is deleted only once they are gone (or moved). */
  .delete("/:id", requirePermission("catalog:write"), async (c) => {
    const id = c.req.param("id");
    const { db, d1, tenant: t } = c.var.auth;
    const current = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.tenantId, t.id))).get();
    if (!current) throw notFound("Categoría");
    const [kids] = await db.select({ n: count() }).from(categories).where(and(eq(categories.tenantId, t.id), eq(categories.parentId, id)));
    if (kids?.n) throw new AppError(409, "has_subcategories", `Tiene ${kids.n === 1 ? "una subcategoría" : `${kids.n} subcategorías`}. Elimínalas o muévelas a otra categoría primero.`);
    await d1.batch([
      toStatement(d1, db.update(products).set({ categoryId: null }).where(and(eq(products.categoryId, id), eq(products.tenantId, t.id)))),
      toStatement(d1, db.delete(categories).where(and(eq(categories.id, id), eq(categories.tenantId, t.id)))),
      toStatement(d1, auditEntry(c, { action: "category.delete", entity: "category", entityId: id, before: { name: current.name } })),
    ]);
    return c.body(null, 204);
  });

/** A parent is a main category of this business (one level), and not the category itself. */
async function validParent(c: { var: AppEnv["Variables"] }, parentId: string, selfId: string | null) {
  const { db, tenant: t } = c.var.auth;
  if (parentId === selfId) throw catError("parentId", "Una categoría no puede estar dentro de sí misma");
  const parent = await db.select().from(categories).where(and(eq(categories.id, parentId), eq(categories.tenantId, t.id))).get();
  if (!parent) throw catError("parentId", "Esa categoría no existe");
  if (parent.parentId) throw catError("parentId", "Solo hay un nivel: elige una categoría principal");
  return parent;
}
