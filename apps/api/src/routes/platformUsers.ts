/**
 * /api/platform/users: every person with an account (owners, admins, cashiers) across businesses.
 * Operators can hand out a password link, lift a sign-in lockout, sign someone out everywhere,
 * or disable an account.
 */
import { Hono } from "hono";
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { control, controlDb, tenant } from "@nexo/db";
import { membershipUpdateSchema, platformUserUpdateSchema, ROLE_LABELS, type PlatformUser, type PlatformUserDetail } from "@nexo/shared";
import type { Env } from "../env";
import { newId, randomToken, sha256Hex } from "../lib/crypto";
import { getTenantDb } from "../lib/tenant";
import { sendEmail } from "../lib/email";
import { AppError } from "../lib/errors";
import { inSlices, platformLogEntry, requireOp, type PlatformEnv } from "../lib/operator";
import { json } from "../lib/validate";

const RESET_MINUTES = 60;
const LOCK_MINUTES = 15;
const MAX_FAILED = 5;

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "disabled", "locked"]).default("all"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

type UserRow = typeof control.users.$inferSelect;

async function decorate(env: Env, rows: UserRow[]): Promise<PlatformUser[]> {
  if (!rows.length) return [];
  const cdb = controlDb(env.DB_CONTROL);
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const [memberships, failed] = await Promise.all([
    inSlices(rows.map((r) => r.id), (slice) =>
      cdb
        .select({
          userId: control.memberships.userId, tenantId: control.tenants.id, tenantName: control.tenants.name, tenantSlug: control.tenants.slug, tenantStatus: control.tenants.status,
          role: control.memberships.role, roleId: control.memberships.roleId, roleName: control.tenantRoles.name, active: control.memberships.active,
        })
        .from(control.memberships)
        .innerJoin(control.tenants, eq(control.tenants.id, control.memberships.tenantId))
        .leftJoin(control.tenantRoles, eq(control.tenantRoles.id, control.memberships.roleId))
        .where(inArray(control.memberships.userId, slice))),
    inSlices(rows.map((r) => r.email), (slice) =>
      cdb
        .select({ email: control.loginAttempts.email, n: count() })
        .from(control.loginAttempts)
        .where(and(inArray(control.loginAttempts.email, slice), eq(control.loginAttempts.success, false), gt(control.loginAttempts.createdAt, since)))
        .groupBy(control.loginAttempts.email)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    createdAt: r.createdAt,
    disabledAt: r.disabledAt,
    deletedAt: r.deletedAt,
    lastLoginAt: r.lastLoginAt,
    locked: (failed.find((f) => f.email === r.email)?.n ?? 0) >= MAX_FAILED,
    memberships: memberships.filter((m) => m.userId === r.id).map(({ userId: _u, ...m }) => ({ ...m, roleName: m.roleName ?? null })),
  }));
}

async function userRow(env: Env, id: string) {
  const row = await controlDb(env.DB_CONTROL).select().from(control.users).where(eq(control.users.id, id)).get();
  if (!row) throw new AppError(404, "not_found", "Usuario no encontrado");
  return row;
}

async function detail(env: Env, id: string): Promise<PlatformUserDetail> {
  const row = await userRow(env, id);
  const cdb = controlDb(env.DB_CONTROL);
  const [base] = await decorate(env, [row]);
  const [[sessions], attempts] = await Promise.all([
    cdb.select({ n: count() }).from(control.sessions).where(and(eq(control.sessions.userId, id), isNull(control.sessions.operatorId), gt(control.sessions.expiresAt, new Date().toISOString()))),
    cdb.select({ success: control.loginAttempts.success, ip: control.loginAttempts.ip, createdAt: control.loginAttempts.createdAt }).from(control.loginAttempts).where(eq(control.loginAttempts.email, row.email)).orderBy(desc(control.loginAttempts.createdAt)).limit(10),
  ]);
  const tenantIds = base!.memberships.map((m) => m.tenantId);
  const roles = tenantIds.length
    ? await cdb.select({ id: control.tenantRoles.id, name: control.tenantRoles.name, tenantId: control.tenantRoles.tenantId }).from(control.tenantRoles).where(inArray(control.tenantRoles.tenantId, tenantIds))
    : [];
  const tenantRoles = Object.fromEntries(tenantIds.map((t) => [t, roles.filter((r) => r.tenantId === t).map(({ id, name }) => ({ id, name }))]));
  return { ...base!, tenantRoles, sessions: sessions?.n ?? 0, attempts };
}

/** The business the user belongs to (first one), so the log can be filtered by business too. */
async function firstTenant(env: Env, userId: string) {
  const m = await controlDb(env.DB_CONTROL).select({ tenantId: control.memberships.tenantId }).from(control.memberships).where(eq(control.memberships.userId, userId)).get();
  return m?.tenantId ?? null;
}

export const platformUserRoutes = new Hono<PlatformEnv>()
  .use("*", requireOp("users:read"))
  .get("/", async (c) => {
    const q = listQuery.parse(c.req.query());
    const u = control.users;
    const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
    const term = q.q?.toLowerCase();
    const where = and(
      isNull(u.deletedAt),
      term ? or(like(sql`lower(${u.name})`, `%${term}%`), like(u.email, `%${term}%`), sql`${u.id} IN (SELECT m.user_id FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE lower(t.name) LIKE ${`%${term}%`})`) : undefined,
      q.status === "disabled" ? isNotNull(u.disabledAt) : undefined,
      q.status === "locked" ? sql`(SELECT COUNT(*) FROM login_attempts a WHERE a.email = ${u.email} AND a.success = 0 AND a.created_at > ${since}) >= ${MAX_FAILED}` : undefined,
    );
    const cdb = controlDb(c.env.DB_CONTROL);
    const [rows, [total]] = await Promise.all([
      cdb.select().from(u).where(where).orderBy(desc(u.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      cdb.select({ n: count() }).from(u).where(where),
    ]);
    return c.json({ items: await decorate(c.env, rows), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
  })

  .get("/:id", async (c) => c.json(await detail(c.env, c.req.param("id"))))

  /**
   * A one-hour link to choose a new password. It is emailed to the person and also returned, so support
   * can hand it over another way (useful while email is not set up).
   */
  .post("/:id/reset-link", requireOp("users:manage"), async (c) => {
    const row = await userRow(c.env, c.req.param("id"));
    if (row.deletedAt) throw new AppError(409, "deleted", "Este usuario fue eliminado.");
    const cdb = controlDb(c.env.DB_CONTROL);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000).toISOString();
    await cdb.batch([
      cdb.insert(control.passwordResets).values({ tokenHash: await sha256Hex(token), userId: row.id, expiresAt }),
      platformLogEntry(c, { action: "user.reset_link", entity: "user", entityId: row.id, tenantId: await firstTenant(c.env, row.id), summary: `${row.name} (${row.email})` }),
    ]);
    const url = `${c.env.APP_URL}/restablecer?token=${encodeURIComponent(token)}`;
    c.executionCtx.waitUntil(
      sendEmail(c.env, { to: row.email, subject: "Restablece tu contraseña de Nexo", text: `Hola ${row.name}:\n\nSoporte de Nexo generó este enlace para que elijas una nueva contraseña (vence en ${RESET_MINUTES} minutos):\n${url}\n\nSi no lo pediste, ignora este correo.` }).catch((e) => console.error("[platform] reset email", e)),
    );
    return c.json({ url, expiresAt });
  })

  /** Lifts the 15-minute lockout after too many failed sign-ins. */
  .post("/:id/unlock", requireOp("users:manage"), async (c) => {
    const row = await userRow(c.env, c.req.param("id"));
    const cdb = controlDb(c.env.DB_CONTROL);
    await cdb.batch([
      cdb.delete(control.loginAttempts).where(and(eq(control.loginAttempts.email, row.email), eq(control.loginAttempts.success, false))),
      platformLogEntry(c, { action: "user.unlock", entity: "user", entityId: row.id, tenantId: await firstTenant(c.env, row.id), summary: `${row.name} (${row.email})` }),
    ]);
    return c.json(await detail(c.env, row.id));
  })

  /** Signs the person out on every device (not support sessions). */
  .post("/:id/logout-all", requireOp("users:manage"), async (c) => {
    const row = await userRow(c.env, c.req.param("id"));
    const cdb = controlDb(c.env.DB_CONTROL);
    await cdb.batch([
      cdb.delete(control.sessions).where(and(eq(control.sessions.userId, row.id), isNull(control.sessions.operatorId))),
      platformLogEntry(c, { action: "user.logout_all", entity: "user", entityId: row.id, tenantId: await firstTenant(c.env, row.id), summary: `${row.name} (${row.email})` }),
    ]);
    return c.json(await detail(c.env, row.id));
  })

  /** Disable (cannot sign in anywhere, sessions end) or enable again. */
  .patch("/:id", requireOp("users:manage"), json(platformUserUpdateSchema), async (c) => {
    const row = await userRow(c.env, c.req.param("id"));
    const { disabled } = c.req.valid("json");
    if (disabled === Boolean(row.disabledAt)) return c.json(await detail(c.env, row.id));
    const cdb = controlDb(c.env.DB_CONTROL);
    const log = platformLogEntry(c, { action: disabled ? "user.disable" : "user.enable", entity: "user", entityId: row.id, tenantId: await firstTenant(c.env, row.id), summary: `${row.name} (${row.email})` });
    if (disabled) {
      await cdb.batch([
        cdb.update(control.users).set({ disabledAt: new Date().toISOString() }).where(eq(control.users.id, row.id)),
        cdb.delete(control.sessions).where(and(eq(control.sessions.userId, row.id), isNull(control.sessions.operatorId))),
        log,
      ]);
    } else {
      await cdb.batch([cdb.update(control.users).set({ disabledAt: null }).where(eq(control.users.id, row.id)), log]);
    }
    return c.json(await detail(c.env, row.id));
  })

  /**
   * Access of a person inside one business: built-in role, a custom role of that business, or access on/off.
   * The owner stays as is. Logged in the platform log and in the business's own activity.
   */
  .patch("/:id/memberships/:tenantId", requireOp("users:roles"), json(membershipUpdateSchema), async (c) => {
    const input = c.req.valid("json");
    const userId = c.req.param("id");
    const tenantId = c.req.param("tenantId");
    const cdb = controlDb(c.env.DB_CONTROL);
    const user = await userRow(c.env, userId);
    const where = and(eq(control.memberships.tenantId, tenantId), eq(control.memberships.userId, userId));
    const current = await cdb.select().from(control.memberships).where(where).get();
    if (!current) throw new AppError(404, "not_found", "Esa persona no pertenece a ese negocio");
    if (current.role === "owner") throw new AppError(409, "owner_locked", "El propietario no se puede modificar.");
    let roleId = current.roleId;
    let role = current.role;
    let roleName: string | null = null;
    if (input.roleId) {
      const r = await cdb.select().from(control.tenantRoles).where(and(eq(control.tenantRoles.id, input.roleId), eq(control.tenantRoles.tenantId, tenantId))).get();
      if (!r) throw new AppError(422, "validation_error", "Revisa los campos marcados", { roleId: "Ese rol no es de este negocio" });
      roleId = r.id;
      role = "cashier";
      roleName = r.name;
    } else if (input.role || input.roleId === null) {
      roleId = null;
      role = input.role ?? (current.roleId ? "cashier" : current.role);
    }
    const active = input.active ?? current.active;
    const label = async (rl: string, rid: string | null) =>
      rid ? ((await cdb.select({ name: control.tenantRoles.name }).from(control.tenantRoles).where(eq(control.tenantRoles.id, rid)).get())?.name ?? "Rol eliminado") : ROLE_LABELS[rl as keyof typeof ROLE_LABELS];
    const before = `${await label(current.role, current.roleId)}${current.active ? "" : " (sin acceso)"}`;
    const after = `${roleName ?? (await label(role, roleId))}${active ? "" : " (sin acceso)"}`;
    if (before === after) return c.json(await detail(c.env, userId));
    const tenantRow = await cdb.select().from(control.tenants).where(eq(control.tenants.id, tenantId)).get();
    await cdb.batch([
      cdb.update(control.memberships).set({ role, roleId, active }).where(where),
      ...(current.active && !active ? [cdb.delete(control.sessions).where(and(eq(control.sessions.userId, userId), eq(control.sessions.tenantId, tenantId), isNull(control.sessions.operatorId)))] : []),
      platformLogEntry(c, { action: "user.role", entity: "user", entityId: userId, tenantId, summary: `${user.name} en ${tenantRow?.name ?? "el negocio"}: ${before} → ${after}` }),
    ] as unknown as Parameters<typeof cdb.batch>[0]);
    // The business sees it in its Activity, under the operator's name.
    if (tenantRow) {
      const op = c.var.operator.operator;
      await getTenantDb(c.env, tenantRow).db.insert(tenant.auditLog).values({
        id: newId(), tenantId, userId, userName: `Soporte Nexo · ${op.name}`, action: "user.update", entity: "user", entityId: userId,
        before: { role: before }, after: { role: after }, ip: c.req.header("cf-connecting-ip") ?? null,
      });
    }
    return c.json(await detail(c.env, userId));
  });
