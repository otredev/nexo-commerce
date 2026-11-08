/**
 * /api/platform/users: every person with an account (owners, admins, cashiers) across businesses.
 * Operators can hand out a password link, lift a sign-in lockout, sign someone out everywhere,
 * or disable an account.
 */
import { Hono } from "hono";
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { control, controlDb } from "@nexo/db";
import { platformUserUpdateSchema, type PlatformUser, type PlatformUserDetail } from "@nexo/shared";
import type { Env } from "../env";
import { randomToken, sha256Hex } from "../lib/crypto";
import { sendEmail } from "../lib/email";
import { AppError } from "../lib/errors";
import { inSlices, platformLogEntry, type PlatformEnv } from "../lib/operator";
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
        .select({ userId: control.memberships.userId, tenantId: control.tenants.id, tenantName: control.tenants.name, tenantSlug: control.tenants.slug, tenantStatus: control.tenants.status, role: control.memberships.role, active: control.memberships.active })
        .from(control.memberships)
        .innerJoin(control.tenants, eq(control.tenants.id, control.memberships.tenantId))
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
    memberships: memberships.filter((m) => m.userId === r.id).map(({ userId: _u, ...m }) => m),
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
  return { ...base!, sessions: sessions?.n ?? 0, attempts };
}

/** The business the user belongs to (first one), so the log can be filtered by business too. */
async function firstTenant(env: Env, userId: string) {
  const m = await controlDb(env.DB_CONTROL).select({ tenantId: control.memberships.tenantId }).from(control.memberships).where(eq(control.memberships.userId, userId)).get();
  return m?.tenantId ?? null;
}

export const platformUserRoutes = new Hono<PlatformEnv>()
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
  .post("/:id/reset-link", async (c) => {
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
  .post("/:id/unlock", async (c) => {
    const row = await userRow(c.env, c.req.param("id"));
    const cdb = controlDb(c.env.DB_CONTROL);
    await cdb.batch([
      cdb.delete(control.loginAttempts).where(and(eq(control.loginAttempts.email, row.email), eq(control.loginAttempts.success, false))),
      platformLogEntry(c, { action: "user.unlock", entity: "user", entityId: row.id, tenantId: await firstTenant(c.env, row.id), summary: `${row.name} (${row.email})` }),
    ]);
    return c.json(await detail(c.env, row.id));
  })

  /** Signs the person out on every device (not support sessions). */
  .post("/:id/logout-all", async (c) => {
    const row = await userRow(c.env, c.req.param("id"));
    const cdb = controlDb(c.env.DB_CONTROL);
    await cdb.batch([
      cdb.delete(control.sessions).where(and(eq(control.sessions.userId, row.id), isNull(control.sessions.operatorId))),
      platformLogEntry(c, { action: "user.logout_all", entity: "user", entityId: row.id, tenantId: await firstTenant(c.env, row.id), summary: `${row.name} (${row.email})` }),
    ]);
    return c.json(await detail(c.env, row.id));
  })

  /** Disable (cannot sign in anywhere, sessions end) or enable again. */
  .patch("/:id", json(platformUserUpdateSchema), async (c) => {
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
  });
