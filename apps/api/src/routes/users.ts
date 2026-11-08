import { Hono, type Context } from "hono";
import { and, asc, count, eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { createUserSchema, customRoleSchema, effectivePermissions, ROLE_LABELS, updateMemberSchema, type CustomRole, type Member, type Permission, type Role } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { hashPassword, newId } from "../lib/crypto";
import { assertWithinLimit } from "../lib/plan";
import { AppError, isUniqueViolation, notFound } from "../lib/errors";
import { destroyUserSessions } from "../lib/session";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

/** A business keeps its custom roles short and meaningful. */
const MAX_ROLES = 20;

type RoleRow = typeof control.tenantRoles.$inferSelect;

async function roleOf(c: Context<AppEnv>, id: string): Promise<RoleRow> {
  const row = await controlDb(c.env.DB_CONTROL)
    .select()
    .from(control.tenantRoles)
    .where(and(eq(control.tenantRoles.id, id), eq(control.tenantRoles.tenantId, c.var.auth.tenant.id)))
    .get();
  if (!row) throw new AppError(422, "validation_error", "Revisa los campos marcados", { roleId: "Ese rol no existe" });
  return row;
}

/**
 * Nobody gives what they do not have: a non-owner can only assign roles (or write roles) whose permissions
 * are all among their own. The owner has everything.
 */
function assertNoEscalation(c: Context<AppEnv>, granted: readonly Permission[]) {
  const { role, permissions } = c.var.auth;
  if (role === "owner") return;
  const missing = granted.filter((p) => !permissions.includes(p));
  if (missing.length) throw new AppError(403, "escalation", "No puedes dar permisos que tú no tienes.", { permissions: `Te faltan: ${missing.join(", ")}` });
}

/** Permissions a membership would get: built-in role, or the custom role (base cashier). */
async function grantedBy(c: Context<AppEnv>, role: Role, roleId: string | null): Promise<{ role: Role; roleId: string | null; permissions: Permission[]; name: string }> {
  if (!roleId) return { role, roleId: null, permissions: effectivePermissions(role, null), name: ROLE_LABELS[role] };
  const r = await roleOf(c, roleId);
  // A custom role rides on "cashier" so anything that still reads the built-in role stays on the safe side.
  return { role: "cashier", roleId: r.id, permissions: effectivePermissions("cashier", r.permissions), name: r.name };
}

const toRole = (r: RoleRow, members: number): CustomRole => ({
  id: r.id,
  name: r.name,
  description: r.description,
  permissions: effectivePermissions("cashier", r.permissions),
  members,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

async function listRoles(c: Context<AppEnv>): Promise<CustomRole[]> {
  const cdb = controlDb(c.env.DB_CONTROL);
  const t = c.var.auth.tenant.id;
  const [rows, counts] = await Promise.all([
    cdb.select().from(control.tenantRoles).where(eq(control.tenantRoles.tenantId, t)).orderBy(asc(control.tenantRoles.name)),
    cdb.select({ roleId: control.memberships.roleId, n: count() }).from(control.memberships).where(eq(control.memberships.tenantId, t)).groupBy(control.memberships.roleId),
  ]);
  return rows.map((r) => toRole(r, counts.find((x) => x.roleId === r.id)?.n ?? 0));
}

/** Users and memberships live in the control DB; the audit trail lives in the business DB. */
export const userRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("users:read"), async (c) => {
    const cdb = controlDb(c.env.DB_CONTROL);
    const rows = await cdb
      .select({
        userId: control.users.id,
        name: control.users.name,
        email: control.users.email,
        role: control.memberships.role,
        roleId: control.memberships.roleId,
        roleName: control.tenantRoles.name,
        active: control.memberships.active,
        createdAt: control.memberships.createdAt,
      })
      .from(control.memberships)
      .innerJoin(control.users, eq(control.users.id, control.memberships.userId))
      .leftJoin(control.tenantRoles, eq(control.tenantRoles.id, control.memberships.roleId))
      .where(eq(control.memberships.tenantId, c.var.auth.tenant.id))
      .orderBy(asc(control.memberships.createdAt));
    const body: Member[] = rows.map((r) => ({ ...r, roleName: r.roleName ?? null }));
    return c.json(body);
  })

  .post("/", requirePermission("users:write"), json(createUserSchema), async (c) => {
    const input = c.req.valid("json");
    const { tenant: t, db } = c.var.auth;
    const cdb = controlDb(c.env.DB_CONTROL);
    const exists = await cdb.select({ id: control.users.id }).from(control.users).where(eq(control.users.email, input.email)).get();
    if (exists) throw new AppError(409, "email_taken", "Este correo ya tiene una cuenta", { email: "Este correo ya tiene una cuenta" });
    const grant = await grantedBy(c, input.role, input.roleId);
    assertNoEscalation(c, grant.permissions);
    await assertWithinLimit(c, "users");

    const userId = newId();
    await cdb.batch([
      cdb.insert(control.users).values({ id: userId, email: input.email, name: input.name, passwordHash: await hashPassword(input.password) }),
      cdb.insert(control.memberships).values({ tenantId: t.id, userId, role: grant.role, roleId: grant.roleId }),
    ]);
    await db.batch([auditEntry(c, { action: "user.create", entity: "user", entityId: userId, after: { name: input.name, email: input.email, role: grant.name } })]);

    const member: Member = { userId, name: input.name, email: input.email, role: grant.role, roleId: grant.roleId, roleName: grant.roleId ? grant.name : null, active: true, createdAt: new Date().toISOString() };
    return c.json(member, 201);
  })

  .patch("/:userId", requirePermission("users:write"), json(updateMemberSchema), async (c) => {
    const input = c.req.valid("json");
    const userId = c.req.param("userId");
    const { tenant: t, user: me, db } = c.var.auth;
    const cdb = controlDb(c.env.DB_CONTROL);
    const where = and(eq(control.memberships.tenantId, t.id), eq(control.memberships.userId, userId));
    const current = await cdb.select().from(control.memberships).where(where).get();
    if (!current) throw notFound("Usuario");
    if (current.role === "owner") throw new AppError(409, "owner_locked", "El propietario no se puede modificar");
    if (userId === me.id) throw new AppError(409, "self_change", "No puedes cambiar tu propio rol ni desactivarte");

    // Role: a built-in role clears the custom one; a custom role keeps "cashier" underneath.
    const roleChange = input.role !== undefined || input.roleId !== undefined;
    const grant = roleChange
      ? await grantedBy(c, input.role ?? current.role, input.roleId === undefined ? (input.role ? null : current.roleId) : input.roleId)
      : null;
    if (grant) assertNoEscalation(c, grant.permissions);
    // Nor take away from someone with more than you (an admin can't be edited by a custom-role manager).
    const theirs = current.roleId ? (await grantedBy(c, current.role, current.roleId)).permissions : effectivePermissions(current.role, null);
    assertNoEscalation(c, theirs);

    const next = { role: grant?.role ?? current.role, roleId: grant ? grant.roleId : current.roleId, active: input.active ?? current.active };
    if (!current.active && next.active) await assertWithinLimit(c, "users");
    await cdb.update(control.memberships).set(next).where(where);
    if (current.active && !next.active) await destroyUserSessions(c.env, userId, t.id);
    const label = async (role: Role, roleId: string | null) => (roleId ? (await grantedBy(c, role, roleId).catch(() => ({ name: "Rol eliminado" }))).name : ROLE_LABELS[role]);
    const changes = diff({ role: await label(current.role, current.roleId), active: current.active }, { role: await label(next.role, next.roleId), active: next.active });
    if (changes.changed) {
      await db.batch([auditEntry(c, { action: "user.update", entity: "user", entityId: userId, before: changes.before, after: changes.after })]);
    }
    return c.json({ userId, ...next, roleName: grant?.roleId ? grant.name : null });
  })

  /* ---------- Custom roles ---------- */

  .get("/roles", requirePermission("users:read"), async (c) => c.json({ items: await listRoles(c) }))

  .post("/roles", requirePermission("users:write"), json(customRoleSchema), async (c) => {
    const input = c.req.valid("json");
    const { tenant: t, db } = c.var.auth;
    assertNoEscalation(c, input.permissions);
    const cdb = controlDb(c.env.DB_CONTROL);
    const [existing] = await cdb.select({ n: count() }).from(control.tenantRoles).where(eq(control.tenantRoles.tenantId, t.id));
    if ((existing?.n ?? 0) >= MAX_ROLES) throw new AppError(409, "too_many_roles", `Puedes tener hasta ${MAX_ROLES} roles.`);
    const id = newId();
    try {
      await cdb.insert(control.tenantRoles).values({ id, tenantId: t.id, name: input.name, description: input.description, permissions: input.permissions });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError(409, "duplicate", "Ya tienes un rol con ese nombre", { name: "Ya tienes un rol con ese nombre" });
      throw e;
    }
    await db.batch([auditEntry(c, { action: "role.create", entity: "role", entityId: id, after: { name: input.name, permissions: input.permissions.length } })]);
    return c.json(toRole((await roleOf(c, id)), 0), 201);
  })

  .put("/roles/:id", requirePermission("users:write"), json(customRoleSchema), async (c) => {
    const input = c.req.valid("json");
    const before = await roleOf(c, c.req.param("id"));
    // Editing a role changes what its people can do: same rule as assigning it, before and after.
    assertNoEscalation(c, effectivePermissions("cashier", before.permissions));
    assertNoEscalation(c, input.permissions);
    const cdb = controlDb(c.env.DB_CONTROL);
    try {
      await cdb.update(control.tenantRoles).set({ name: input.name, description: input.description, permissions: input.permissions, updatedAt: new Date().toISOString() }).where(eq(control.tenantRoles.id, before.id));
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError(409, "duplicate", "Ya tienes un rol con ese nombre", { name: "Ya tienes un rol con ese nombre" });
      throw e;
    }
    const added = input.permissions.filter((p) => !before.permissions.includes(p));
    const removed = before.permissions.filter((p) => !(input.permissions as string[]).includes(p));
    await c.var.auth.db.batch([auditEntry(c, { action: "role.update", entity: "role", entityId: before.id, before: { name: before.name, removed }, after: { name: input.name, added } })]);
    const roles = await listRoles(c);
    return c.json(roles.find((r) => r.id === before.id)!);
  })

  /** Only roles nobody has: move people to another role first. */
  .delete("/roles/:id", requirePermission("users:write"), async (c) => {
    const role = await roleOf(c, c.req.param("id"));
    assertNoEscalation(c, effectivePermissions("cashier", role.permissions));
    const cdb = controlDb(c.env.DB_CONTROL);
    const [used] = await cdb.select({ n: count() }).from(control.memberships).where(and(eq(control.memberships.tenantId, c.var.auth.tenant.id), eq(control.memberships.roleId, role.id)));
    if (used?.n) throw new AppError(409, "role_in_use", `${used.n === 1 ? "Una persona tiene" : `${used.n} personas tienen`} este rol. Cámbialas de rol antes de eliminarlo.`);
    await cdb.delete(control.tenantRoles).where(eq(control.tenantRoles.id, role.id));
    await c.var.auth.db.batch([auditEntry(c, { action: "role.delete", entity: "role", entityId: role.id, before: { name: role.name } })]);
    return c.body(null, 204);
  });
