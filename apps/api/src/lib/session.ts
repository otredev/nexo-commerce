import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { effectivePermissions, effectivePlan, ROLE_LABELS, type Permission, type Role } from "@nexo/shared";
import type { AppEnv, Env, TenantAuth } from "../env";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "nx_session";
/** Support access from /admin ("Entrar como negocio"): a short session that takes precedence over nx_session. */
export const SUPPORT_COOKIE = "nx_support";
const SESSION_DAYS = 30;
/** Sessions are extended when less than this many days remain (sliding expiration). */
const RENEW_WHEN_DAYS_LEFT = 15;

const days = (n: number) => n * 24 * 60 * 60 * 1000;

export async function createSession(c: Context<AppEnv>, userId: string, tenantId: string) {
  const token = randomToken();
  const id = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + days(SESSION_DAYS));
  await controlDb(c.env.DB_CONTROL).insert(control.sessions).values({
    id,
    userId,
    tenantId,
    expiresAt: expiresAt.toISOString(),
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  });
  writeCookie(c, token, expiresAt);
  return id;
}

function writeCookie(c: Context<AppEnv>, token: string, expires: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.env.APP_ENV !== "development",
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export interface LoadedSession {
  sessionId: string;
  expiresAt: string;
  user: { id: string; name: string; email: string };
  tenant: TenantAuth;
  role: Role;
  /** What this member can do: their custom role's permissions, or the built-in role's. */
  permissions: Permission[];
  roleName: string;
  /** Opened by an operator from /admin: acts as the owner, logged under the operator's name. */
  support?: { operatorId: string; operatorName: string; ticketId: string | null };
}

/** Creates the support session of an operator inside a business, as its owner. Returns its expiry. */
export async function createSupportSession(c: Context, input: { userId: string; tenantId: string; operatorId: string; operatorName: string; ticketId: string | null; minutes: number }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);
  const env = c.env as Env;
  await controlDb(env.DB_CONTROL).insert(control.sessions).values({
    id: await sha256Hex(token),
    userId: input.userId,
    tenantId: input.tenantId,
    expiresAt: expiresAt.toISOString(),
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
    operatorId: input.operatorId,
    operatorName: input.operatorName,
    ticketId: input.ticketId,
  });
  setCookie(c, SUPPORT_COOKIE, token, { httpOnly: true, secure: env.APP_ENV !== "development", sameSite: "Lax", path: "/", expires: expiresAt });
  return expiresAt.toISOString();
}

export function clearSupportCookie(c: Context) {
  deleteCookie(c, SUPPORT_COOKIE, { path: "/" });
}

/** Resolves the cookie to a session with its user, tenant and active membership (support access first). */
export async function loadSession(c: Context<AppEnv>): Promise<LoadedSession | null> {
  const support = getCookie(c, SUPPORT_COOKIE);
  if (support) {
    const loaded = await loadSessionToken(c, support, true);
    if (loaded) return loaded;
    clearSupportCookie(c);
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return loadSessionToken(c, token, false);
}

async function loadSessionToken(c: Context<AppEnv>, token: string, supportCookie: boolean): Promise<LoadedSession | null> {
  const id = await sha256Hex(token);
  const db = controlDb(c.env.DB_CONTROL);
  const nowIso = new Date().toISOString();
  const [row] = await db
    .select({
      sessionId: control.sessions.id,
      expiresAt: control.sessions.expiresAt,
      userId: control.users.id,
      userName: control.users.name,
      userEmail: control.users.email,
      userDeleted: control.users.deletedAt,
      userDisabled: control.users.disabledAt,
      operatorId: control.sessions.operatorId,
      operatorName: control.sessions.operatorName,
      ticketId: control.sessions.ticketId,
      tenantId: control.tenants.id,
      tenantSlug: control.tenants.slug,
      tenantName: control.tenants.name,
      tenantStatus: control.tenants.status,
      plan: control.tenants.plan,
      planStatus: control.tenants.planStatus,
      suspendedReason: control.tenants.suspendedReason,
      dbBinding: control.tenants.dbBinding,
      role: control.memberships.role,
      active: control.memberships.active,
      customName: control.tenantRoles.name,
      customPermissions: control.tenantRoles.permissions,
    })
    .from(control.sessions)
    .innerJoin(control.users, eq(control.users.id, control.sessions.userId))
    .innerJoin(control.tenants, eq(control.tenants.id, control.sessions.tenantId))
    .innerJoin(
      control.memberships,
      and(eq(control.memberships.userId, control.sessions.userId), eq(control.memberships.tenantId, control.sessions.tenantId)),
    )
    .leftJoin(control.tenantRoles, and(eq(control.tenantRoles.id, control.memberships.roleId), eq(control.tenantRoles.tenantId, control.memberships.tenantId)))
    .where(and(eq(control.sessions.id, id), gt(control.sessions.expiresAt, nowIso)))
    .limit(1);

  if (!row || row.userDeleted || !row.active || row.tenantStatus === "provisioning") return null;
  // A support session only works through its own cookie, and a normal one never through it.
  if (Boolean(row.operatorId) !== supportCookie) return null;
  // Disabled by the platform: no access (support can still enter to help).
  if (row.userDisabled && !row.operatorId) return null;

  // Sliding expiration (support sessions keep their short, fixed life).
  if (!row.operatorId && new Date(row.expiresAt).getTime() - Date.now() < days(RENEW_WHEN_DAYS_LEFT)) {
    const expiresAt = new Date(Date.now() + days(SESSION_DAYS));
    await db.update(control.sessions).set({ expiresAt: expiresAt.toISOString() }).where(eq(control.sessions.id, id));
    writeCookie(c, token, expiresAt);
  }

  return {
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
    // Changes made by support are logged under the operator's name, never as the owner.
    user: { id: row.userId, name: row.operatorId ? `Soporte Nexo · ${row.operatorName}` : row.userName, email: row.userEmail },
    ...(row.operatorId ? { support: { operatorId: row.operatorId, operatorName: row.operatorName ?? "Soporte", ticketId: row.ticketId } } : {}),
    tenant: {
      id: row.tenantId, slug: row.tenantSlug, name: row.tenantName, dbBinding: row.dbBinding,
      status: row.tenantStatus, plan: effectivePlan(row.plan, row.planStatus), suspendedReason: row.suspendedReason,
    },
    role: row.role,
    // Support access acts as the owner: everything (minus what requireAuth blocks for support).
    permissions: effectivePermissions(row.role, row.customPermissions),
    roleName: row.customName && row.role !== "owner" ? row.customName : ROLE_LABELS[row.role],
  };
}

export async function destroySession(env: Env, sessionId: string) {
  await controlDb(env.DB_CONTROL).delete(control.sessions).where(eq(control.sessions.id, sessionId));
}

/** Ends every session of a user (password change, deactivation). */
export async function destroyUserSessions(env: Env, userId: string, tenantId?: string) {
  const db = controlDb(env.DB_CONTROL);
  const where = tenantId
    ? and(eq(control.sessions.userId, userId), eq(control.sessions.tenantId, tenantId))
    : eq(control.sessions.userId, userId);
  await db.delete(control.sessions).where(where);
}
