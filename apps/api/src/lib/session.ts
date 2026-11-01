import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { effectivePlan, type Role } from "@nexo/shared";
import type { AppEnv, Env, TenantAuth } from "../env";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "nx_session";
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
}

/** Resolves the cookie to a session with its user, tenant and active membership. */
export async function loadSession(c: Context<AppEnv>): Promise<LoadedSession | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
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
    })
    .from(control.sessions)
    .innerJoin(control.users, eq(control.users.id, control.sessions.userId))
    .innerJoin(control.tenants, eq(control.tenants.id, control.sessions.tenantId))
    .innerJoin(
      control.memberships,
      and(eq(control.memberships.userId, control.sessions.userId), eq(control.memberships.tenantId, control.sessions.tenantId)),
    )
    .where(and(eq(control.sessions.id, id), gt(control.sessions.expiresAt, nowIso)))
    .limit(1);

  if (!row || row.userDeleted || !row.active || row.tenantStatus === "provisioning") return null;

  // Sliding expiration.
  if (new Date(row.expiresAt).getTime() - Date.now() < days(RENEW_WHEN_DAYS_LEFT)) {
    const expiresAt = new Date(Date.now() + days(SESSION_DAYS));
    await db.update(control.sessions).set({ expiresAt: expiresAt.toISOString() }).where(eq(control.sessions.id, id));
    writeCookie(c, token, expiresAt);
  }

  return {
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
    user: { id: row.userId, name: row.userName, email: row.userEmail },
    tenant: {
      id: row.tenantId, slug: row.tenantSlug, name: row.tenantName, dbBinding: row.dbBinding,
      status: row.tenantStatus, plan: effectivePlan(row.plan, row.planStatus), suspendedReason: row.suspendedReason,
    },
    role: row.role,
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
