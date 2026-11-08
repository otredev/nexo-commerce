/**
 * Platform operators (/admin): their own sign-in (cookie nx_platform), separate from business users,
 * and the platform log of everything they do.
 */
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { operatorPermissions, type PlatformPermission } from "@nexo/shared";
import type { AppEnv, Env } from "../env";
import { newId, randomToken, sha256Hex } from "./crypto";
import { AppError } from "./errors";

export const OPERATOR_COOKIE = "nx_platform";
/** Operator sessions are short and slide while in use: 12 hours, renewed when less than 6 remain. */
const SESSION_HOURS = 12;
const RENEW_WHEN_HOURS_LEFT = 6;
const hours = (n: number) => n * 3_600_000;

export interface OperatorAuth {
  sessionId: string;
  operator: { id: string; name: string; email: string };
  permissions: PlatformPermission[];
}

export type PlatformEnv = { Bindings: Env; Variables: AppEnv["Variables"] & { operator: OperatorAuth } };

function writeCookie(c: Context, token: string, expires: Date, secure: boolean) {
  // Strict: the /admin panel is never opened from another site with a session.
  setCookie(c, OPERATOR_COOKIE, token, { httpOnly: true, secure, sameSite: "Strict", path: "/", expires });
}

export async function createOperatorSession(c: Context<PlatformEnv>, operatorId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + hours(SESSION_HOURS));
  await controlDb(c.env.DB_CONTROL).insert(control.platformSessions).values({
    id: await sha256Hex(token),
    operatorId,
    expiresAt: expiresAt.toISOString(),
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  });
  writeCookie(c, token, expiresAt, c.env.APP_ENV !== "development");
}

export async function loadOperator(c: Context<PlatformEnv>): Promise<OperatorAuth | null> {
  const token = getCookie(c, OPERATOR_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const db = controlDb(c.env.DB_CONTROL);
  const row = await db
    .select({ sessionId: control.platformSessions.id, expiresAt: control.platformSessions.expiresAt, id: control.platformOperators.id, name: control.platformOperators.name, email: control.platformOperators.email, active: control.platformOperators.active, permissions: control.platformOperators.permissions })
    .from(control.platformSessions)
    .innerJoin(control.platformOperators, eq(control.platformOperators.id, control.platformSessions.operatorId))
    .where(and(eq(control.platformSessions.id, id), gt(control.platformSessions.expiresAt, new Date().toISOString())))
    .get();
  if (!row || !row.active) return null;
  if (new Date(row.expiresAt).getTime() - Date.now() < hours(RENEW_WHEN_HOURS_LEFT)) {
    const expiresAt = new Date(Date.now() + hours(SESSION_HOURS));
    await db.update(control.platformSessions).set({ expiresAt: expiresAt.toISOString() }).where(eq(control.platformSessions.id, id));
    writeCookie(c, token, expiresAt, c.env.APP_ENV !== "development");
  }
  return { sessionId: row.sessionId, operator: { id: row.id, name: row.name, email: row.email }, permissions: operatorPermissions(row.permissions) };
}

export function clearOperatorCookie(c: Context) {
  deleteCookie(c, OPERATOR_COOKIE, { path: "/" });
}

export const requireOperator = createMiddleware<PlatformEnv>(async (c, next) => {
  const auth = await loadOperator(c);
  if (!auth) throw new AppError(401, "unauthorized", "Inicia sesión en el panel de administración.");
  c.set("operator", auth);
  await next();
});

/** The signed-in operator needs this permission (403 otherwise). */
export const requireOp = (permission: PlatformPermission) =>
  createMiddleware<PlatformEnv>(async (c, next) => {
    if (!c.var.operator.permissions.includes(permission)) throw new AppError(403, "forbidden", "Tu cuenta de operador no tiene permiso para esto.");
    await next();
  });

export const opCan = (c: { var: { operator: OperatorAuth } }, permission: PlatformPermission) => c.var.operator.permissions.includes(permission);

export interface PlatformLogInput {
  action: string;
  entity: string;
  entityId?: string | null;
  tenantId?: string | null;
  summary?: string | null;
  detail?: Record<string, unknown> | null;
}

/** The platform log entry as a query builder, to batch it with the change it describes. */
export function platformLogEntry(c: Context<PlatformEnv>, input: PlatformLogInput, who?: { id: string | null; name: string }) {
  const op = who ?? { id: c.var.operator.operator.id, name: c.var.operator.operator.name };
  return controlDb(c.env.DB_CONTROL).insert(control.platformAudit).values({
    id: newId(),
    operatorId: op.id,
    operatorName: op.name,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    tenantId: input.tenantId ?? null,
    summary: input.summary ?? null,
    detail: input.detail ?? null,
    ip: c.req.header("cf-connecting-ip") ?? null,
  });
}

/** D1 allows at most 100 bound parameters per query: runs `query` over `ids` in slices and joins the rows. */
export async function inSlices<T>(ids: string[], query: (slice: string[]) => Promise<T[]>, size = 80): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await query(ids.slice(i, i + size))));
  return out;
}
