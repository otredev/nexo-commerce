/**
 * Customer accounts of the online store (/api/store/:slug/account): sign up, sign in, profile, password
 * and "Mis pedidos". Signing up creates the customer in the business's Clientes (or links the one with
 * the same email, without overwriting what the business already has).
 */
import { Hono } from "hono";
import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { control, controlDb, tenant } from "@nexo/db";
import {
  storeAccountUpdateSchema, storeForgotSchema, storeLoginSchema, storePasswordChangeSchema, storeRegisterSchema, storeResetSchema,
  type StoreAccount, type StoreAccountOrder,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { hashPassword, newId, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { sendEmail } from "../lib/email";
import { AppError, isUniqueViolation } from "../lib/errors";
import { toStatement } from "../lib/inventory";
import { customerSearchText, normalizePhone } from "../lib/pricing";
import { clearCustomerCookie, createCustomerSession, loadCustomer, toAccount } from "../lib/storeAccount";
import { json } from "../lib/validate";
import { resolveStore, storeBase } from "./store";

const { customerAccounts, customerSessions, customerPasswordResets, customers, orders, auditLog } = tenant;

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 60;
/** Sign-ups from one address per hour and store (keeps scripts from filling Clientes). */
const MAX_SIGNUPS_PER_HOUR = 5;
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
/** Failed sign-ins share the platform's login_attempts table, under a key per store. */
const attemptKey = (tenantId: string, email: string) => `store:${tenantId}:${email}`;

const signedOut = () => new AppError(401, "not_signed_in", "Inicia sesión para continuar.");

export const storeAccountRoutes = new Hono<AppEnv>()
  /** Who is signed in (null when nobody): the store asks on every visit. */
  .get("/:slug/account", async (c) => {
    const { tenant: t, db } = await resolveStore(c);
    const me = await loadCustomer(c, db, t.id, t.slug);
    return c.json({ account: me ? toAccount(me, me.acceptsMarketing) : null }, 200, { "Cache-Control": "private, no-store" });
  })

  .post("/:slug/account/register", json(storeRegisterSchema), async (c) => {
    const input = c.req.valid("json");
    const { tenant: t, db, d1 } = await resolveStore(c);
    const ip = c.req.header("cf-connecting-ip") ?? null;
    if (ip) {
      const [recent] = await db
        .select({ n: count() })
        .from(customerAccounts)
        .where(and(eq(customerAccounts.tenantId, t.id), eq(customerAccounts.createdIp, ip), gt(customerAccounts.createdAt, new Date(Date.now() - 3_600_000).toISOString())));
      if ((recent?.n ?? 0) >= MAX_SIGNUPS_PER_HOUR) throw new AppError(429, "too_many_signups", "Se crearon muchas cuentas desde tu conexión. Intenta más tarde.");
    }
    const taken = await db.select({ id: customerAccounts.id }).from(customerAccounts).where(and(eq(customerAccounts.tenantId, t.id), eq(customerAccounts.email, input.email))).get();
    if (taken) throw new AppError(409, "email_taken", "Ya tienes una cuenta con este correo. Inicia sesión.", { email: "Ya tienes una cuenta con este correo" });

    // The customer in Clientes: the one with this email, or a new one. Never overwrite what the business has.
    const phone = normalizePhone(input.phone);
    const existing = await db.select().from(customers).where(and(eq(customers.tenantId, t.id), eq(customers.email, input.email), eq(customers.archived, false))).get();
    const customerId = existing?.id ?? newId();
    const accountId = newId();
    const now = new Date().toISOString();
    const customerStatement = existing
      ? toStatement(
          d1,
          db
            .update(customers)
            .set({
              phone: existing.phone ?? phone,
              acceptsMarketing: existing.acceptsMarketing || input.acceptsMarketing,
              searchText: customerSearchText({ name: existing.name, email: existing.email, phone: existing.phone ?? phone, taxId: existing.taxId }),
              updatedAt: now,
            })
            .where(eq(customers.id, existing.id)),
        )
      : toStatement(
          d1,
          db.insert(customers).values({
            id: customerId, tenantId: t.id, name: input.name, email: input.email, phone, taxId: null, acceptsMarketing: input.acceptsMarketing, source: "online",
            searchText: customerSearchText({ name: input.name, email: input.email, phone, taxId: null }),
          }),
        );
    try {
      await d1.batch([
        customerStatement,
        toStatement(
          d1,
          db.insert(customerAccounts).values({
            id: accountId, tenantId: t.id, customerId, email: input.email, name: input.name, phone: input.phone, passwordHash: await hashPassword(input.password), createdIp: ip, lastLoginAt: now,
          }),
        ),
        toStatement(d1, db.insert(auditLog).values({ id: newId(), tenantId: t.id, userId: null, userName: input.name, action: "customer.signup", entity: "customer", entityId: customerId, after: { name: input.name, email: input.email, linked: Boolean(existing) }, ip })),
      ]);
    } catch (e) {
      // Two sign-ups with the same email at once: the unique index keeps one.
      if (isUniqueViolation(e)) throw new AppError(409, "email_taken", "Ya tienes una cuenta con este correo. Inicia sesión.", { email: "Ya tienes una cuenta con este correo" });
      throw e;
    }
    await createCustomerSession(c, db, t.id, t.slug, accountId);
    const account = (await db.select().from(customerAccounts).where(eq(customerAccounts.id, accountId)).get())!;
    return c.json({ account: toAccount(account, existing?.acceptsMarketing || input.acceptsMarketing) }, 201);
  })

  .post("/:slug/account/login", json(storeLoginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const { tenant: t, db } = await resolveStore(c);
    const cdb = controlDb(c.env.DB_CONTROL);
    const key = attemptKey(t.id, email);
    const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
    const [failed] = await cdb
      .select({ n: count() })
      .from(control.loginAttempts)
      .where(and(eq(control.loginAttempts.email, key), eq(control.loginAttempts.success, false), gt(control.loginAttempts.createdAt, since)));
    if ((failed?.n ?? 0) >= MAX_FAILED) throw new AppError(429, "too_many_attempts", `Demasiados intentos. Espera ${LOCK_MINUTES} minutos o restablece tu contraseña.`);
    const account = await db.select().from(customerAccounts).where(and(eq(customerAccounts.tenantId, t.id), eq(customerAccounts.email, email))).get();
    const ok = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
    await cdb.insert(control.loginAttempts).values({ email: key, ip: c.req.header("cf-connecting-ip") ?? null, success: Boolean(account && ok) });
    if (!account || !ok) throw new AppError(401, "invalid_credentials", "Correo o contraseña incorrectos");
    await db.update(customerAccounts).set({ lastLoginAt: new Date().toISOString() }).where(eq(customerAccounts.id, account.id));
    await createCustomerSession(c, db, t.id, t.slug, account.id);
    const marketing = await db.select({ v: customers.acceptsMarketing }).from(customers).where(eq(customers.id, account.customerId)).get();
    return c.json({ account: toAccount(account, Boolean(marketing?.v)) });
  })

  .post("/:slug/account/logout", async (c) => {
    const { tenant: t, db } = await resolveStore(c);
    const me = await loadCustomer(c, db, t.id, t.slug);
    if (me) await db.delete(customerSessions).where(eq(customerSessions.id, me.sessionId));
    clearCustomerCookie(c, t.slug);
    return c.body(null, 204);
  })

  /** Profile: the account's own data. In Clientes it only fills what is empty (and the promotions choice). */
  .put("/:slug/account", json(storeAccountUpdateSchema), async (c) => {
    const input = c.req.valid("json");
    const { tenant: t, db, d1 } = await resolveStore(c);
    const me = await loadCustomer(c, db, t.id, t.slug);
    if (!me) throw signedOut();
    const now = new Date().toISOString();
    const customer = await db.select().from(customers).where(eq(customers.id, me.customerId)).get();
    const phone = customer?.phone ?? normalizePhone(input.phone);
    const address = customer?.address ?? input.address;
    await d1.batch([
      toStatement(d1, db.update(customerAccounts).set({ name: input.name, phone: input.phone, address: input.address, updatedAt: now }).where(eq(customerAccounts.id, me.id))),
      ...(customer
        ? [toStatement(d1, db.update(customers).set({ phone, address, acceptsMarketing: input.acceptsMarketing, searchText: customerSearchText({ name: customer.name, email: customer.email, phone, taxId: customer.taxId }), updatedAt: now }).where(eq(customers.id, customer.id)))]
        : []),
    ]);
    const account = (await db.select().from(customerAccounts).where(eq(customerAccounts.id, me.id)).get())!;
    return c.json({ account: toAccount(account, input.acceptsMarketing) });
  })

  .post("/:slug/account/password", json(storePasswordChangeSchema), async (c) => {
    const { currentPassword, newPassword } = c.req.valid("json");
    const { tenant: t, db } = await resolveStore(c);
    const me = await loadCustomer(c, db, t.id, t.slug);
    if (!me) throw signedOut();
    if (!(await verifyPassword(currentPassword, me.passwordHash))) throw new AppError(422, "validation_error", "Revisa los campos marcados", { currentPassword: "La contraseña actual no es correcta" });
    await db.update(customerAccounts).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date().toISOString() }).where(eq(customerAccounts.id, me.id));
    // Other devices are signed out; this one stays.
    await db.delete(customerSessions).where(and(eq(customerSessions.accountId, me.id), ne(customerSessions.id, me.sessionId)));
    return c.body(null, 204);
  })

  /** "Mis pedidos": only orders placed with this account (never earlier ones under the same email). */
  .get("/:slug/account/orders", async (c) => {
    const { tenant: t, db } = await resolveStore(c);
    const me = await loadCustomer(c, db, t.id, t.slug);
    if (!me) throw signedOut();
    const rows = await db
      .select({
        number: orders.number, token: orders.token, status: orders.status, paymentStatus: orders.paymentStatus, paymentMethod: orders.paymentMethod,
        fulfillment: orders.fulfillment, totalCents: orders.totalCents, createdAt: orders.createdAt,
        items: sql<number>`(SELECT COUNT(*) FROM order_items i WHERE i.order_id = "orders"."id")`,
      })
      .from(orders)
      .where(and(eq(orders.tenantId, t.id), eq(orders.accountId, me.id)))
      .orderBy(desc(orders.createdAt))
      .limit(100);
    return c.json({ items: rows as StoreAccountOrder[] }, 200, { "Cache-Control": "private, no-store" });
  })

  /** Always 204, so it never tells whether an email has an account. */
  .post("/:slug/account/forgot", json(storeForgotSchema), async (c) => {
    const { email } = c.req.valid("json");
    const { tenant: t, db, biz } = await resolveStore(c);
    const account = await db.select().from(customerAccounts).where(and(eq(customerAccounts.tenantId, t.id), eq(customerAccounts.email, email))).get();
    if (!account) return c.body(null, 204);
    const token = randomToken();
    await db.insert(customerPasswordResets).values({ tokenHash: await sha256Hex(token), tenantId: t.id, accountId: account.id, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString() });
    const url = `${await storeBase(c, t)}/cuenta/restablecer?token=${encodeURIComponent(token)}`;
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: account.email,
        subject: `Restablece tu contraseña de ${biz.tradeName}`,
        text: `Hola ${account.name}:\n\nPara elegir una nueva contraseña de tu cuenta en ${biz.tradeName}, abre este enlace (vence en ${RESET_MINUTES} minutos):\n${url}\n\nSi no lo pediste, ignora este correo.`,
      }).catch((e) => console.error("[store] reset email", e)),
    );
    // Development convenience only, like the dashboard's own reset.
    if (c.env.APP_ENV === "development") return c.json({ devResetUrl: url });
    return c.body(null, 204);
  })

  /** New password from the emailed link; signs out everywhere and signs in here. */
  .post("/:slug/account/reset", json(storeResetSchema), async (c) => {
    const { token, password } = c.req.valid("json");
    const { tenant: t, db, d1 } = await resolveStore(c);
    const reset = await db
      .select()
      .from(customerPasswordResets)
      .where(and(eq(customerPasswordResets.tokenHash, await sha256Hex(token)), eq(customerPasswordResets.tenantId, t.id), isNull(customerPasswordResets.usedAt), gt(customerPasswordResets.expiresAt, new Date().toISOString())))
      .get();
    if (!reset) throw new AppError(400, "invalid_token", "El enlace no es válido o ya venció. Pide uno nuevo.");
    const account = (await db.select().from(customerAccounts).where(eq(customerAccounts.id, reset.accountId)).get())!;
    const now = new Date().toISOString();
    await d1.batch([
      toStatement(d1, db.update(customerAccounts).set({ passwordHash: await hashPassword(password), updatedAt: now, lastLoginAt: now }).where(eq(customerAccounts.id, account.id))),
      toStatement(d1, db.update(customerPasswordResets).set({ usedAt: now }).where(eq(customerPasswordResets.accountId, account.id))),
      toStatement(d1, db.delete(customerSessions).where(eq(customerSessions.accountId, account.id))),
    ]);
    // A successful reset lifts the sign-in lockout.
    await controlDb(c.env.DB_CONTROL).delete(control.loginAttempts).where(eq(control.loginAttempts.email, attemptKey(t.id, account.email)));
    await createCustomerSession(c, db, t.id, t.slug, account.id);
    const marketing = await db.select({ v: customers.acceptsMarketing }).from(customers).where(eq(customers.id, account.customerId)).get();
    const body: { account: StoreAccount } = { account: toAccount({ ...account, lastLoginAt: now }, Boolean(marketing?.v)) };
    return c.json(body);
  });
