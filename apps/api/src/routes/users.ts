import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { createUserSchema, updateMemberSchema, type Member } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry, diff } from "../lib/audit";
import { hashPassword, newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { destroyUserSessions } from "../lib/session";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

/** Users and memberships live in the control DB; the audit trail lives in the business DB. */
export const userRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("users:read"), async (c) => {
    const cdb = controlDb(c.env.DB_CONTROL);
    const rows: Member[] = await cdb
      .select({
        userId: control.users.id,
        name: control.users.name,
        email: control.users.email,
        role: control.memberships.role,
        active: control.memberships.active,
        createdAt: control.memberships.createdAt,
      })
      .from(control.memberships)
      .innerJoin(control.users, eq(control.users.id, control.memberships.userId))
      .where(eq(control.memberships.tenantId, c.var.auth.tenant.id))
      .orderBy(asc(control.memberships.createdAt));
    return c.json(rows);
  })

  .post("/", requirePermission("users:write"), json(createUserSchema), async (c) => {
    const input = c.req.valid("json");
    const { tenant: t, db } = c.var.auth;
    const cdb = controlDb(c.env.DB_CONTROL);
    const exists = await cdb.select({ id: control.users.id }).from(control.users).where(eq(control.users.email, input.email)).get();
    if (exists) throw new AppError(409, "email_taken", "Este correo ya tiene una cuenta", { email: "Este correo ya tiene una cuenta" });

    const userId = newId();
    await cdb.batch([
      cdb.insert(control.users).values({ id: userId, email: input.email, name: input.name, passwordHash: await hashPassword(input.password) }),
      cdb.insert(control.memberships).values({ tenantId: t.id, userId, role: input.role }),
    ]);
    await db.batch([auditEntry(c, { action: "user.create", entity: "user", entityId: userId, after: { name: input.name, email: input.email, role: input.role } })]);

    const member: Member = { userId, name: input.name, email: input.email, role: input.role, active: true, createdAt: new Date().toISOString() };
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

    const next = { role: input.role ?? current.role, active: input.active ?? current.active };
    await cdb.update(control.memberships).set(next).where(where);
    if (current.active && !next.active) await destroyUserSessions(c.env, userId, t.id);
    const changes = diff({ role: current.role, active: current.active }, next);
    if (changes.changed) {
      await db.batch([auditEntry(c, { action: "user.update", entity: "user", entityId: userId, before: changes.before, after: changes.after })]);
    }
    return c.json({ userId, ...next });
  });
