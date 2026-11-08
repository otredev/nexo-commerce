/**
 * Customer accounts of the online store: one per business. The session lives in the nx_customer cookie,
 * scoped to /api/store/<slug> so two stores on the same domain never see each other's sign-in, and the
 * store's pages (Pages, same origin) reach it through the API proxy.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { tenant, type TenantDb } from "@nexo/db";
import type { StoreAccount } from "@nexo/shared";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "./crypto";

const { customerAccounts, customerSessions, customers } = tenant;

export const CUSTOMER_COOKIE = "nx_customer";
const SESSION_DAYS = 60;
const RENEW_WHEN_DAYS_LEFT = 30;
const days = (n: number) => n * 86_400_000;

export type AccountRow = typeof customerAccounts.$inferSelect;

const cookiePath = (slug: string) => `/api/store/${slug}`;

function writeCookie(c: Context<AppEnv>, slug: string, token: string, expires: Date) {
  setCookie(c, CUSTOMER_COOKIE, token, { httpOnly: true, secure: c.env.APP_ENV !== "development", sameSite: "Lax", path: cookiePath(slug), expires });
}

export function clearCustomerCookie(c: Context<AppEnv>, slug: string) {
  deleteCookie(c, CUSTOMER_COOKIE, { path: cookiePath(slug) });
}

export async function createCustomerSession(c: Context<AppEnv>, db: TenantDb, tenantId: string, slug: string, accountId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + days(SESSION_DAYS));
  await db.insert(customerSessions).values({ id: await sha256Hex(token), tenantId, accountId, expiresAt: expiresAt.toISOString() });
  writeCookie(c, slug, token, expiresAt);
}

/** The signed-in customer of this store, or null. Sessions slide while the customer keeps coming back. */
export async function loadCustomer(c: Context<AppEnv>, db: TenantDb, tenantId: string, slug: string): Promise<(AccountRow & { sessionId: string; acceptsMarketing: boolean }) | null> {
  const token = getCookie(c, CUSTOMER_COOKIE);
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await db
    .select({ account: customerAccounts, expiresAt: customerSessions.expiresAt, acceptsMarketing: customers.acceptsMarketing })
    .from(customerSessions)
    .innerJoin(customerAccounts, eq(customerAccounts.id, customerSessions.accountId))
    .leftJoin(customers, eq(customers.id, customerAccounts.customerId))
    .where(and(eq(customerSessions.id, id), eq(customerSessions.tenantId, tenantId), gt(customerSessions.expiresAt, new Date().toISOString())))
    .get();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() - Date.now() < days(RENEW_WHEN_DAYS_LEFT)) {
    const expiresAt = new Date(Date.now() + days(SESSION_DAYS));
    await db.update(customerSessions).set({ expiresAt: expiresAt.toISOString() }).where(eq(customerSessions.id, id));
    writeCookie(c, slug, token, expiresAt);
  }
  return { ...row.account, sessionId: id, acceptsMarketing: Boolean(row.acceptsMarketing) };
}

export const toAccount = (a: AccountRow, acceptsMarketing: boolean): StoreAccount => ({
  id: a.id,
  name: a.name,
  email: a.email,
  phone: a.phone,
  address: a.address,
  acceptsMarketing,
  createdAt: a.createdAt,
});
