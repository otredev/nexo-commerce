import { Hono } from "hono";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { control, controlDb, tenant } from "@nexo/db";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "@nexo/shared";
import type { AppEnv } from "../env";
import { hashPassword, newId, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { sendEmail } from "../lib/email";
import { AppError } from "../lib/errors";
import { clearSessionCookie, createSession, destroySession, destroyUserSessions, loadSession } from "../lib/session";
import { getTenantDb, slugify } from "../lib/tenant";
import { json } from "../lib/validate";
import { requireAuth } from "../middleware/auth";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_MINUTES = 60;
/** Used to keep login timing constant when the email does not exist. */
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export const authRoutes = new Hono<AppEnv>()
  /** Creates a business, its owner and the first session. */
  .post("/register", json(registerSchema), async (c) => {
    const input = c.req.valid("json");
    const cdb = controlDb(c.env.DB_CONTROL);

    const existing = await cdb.select({ id: control.users.id }).from(control.users).where(eq(control.users.email, input.email)).get();
    if (existing) throw new AppError(409, "email_taken", "Ya existe una cuenta con este correo", { email: "Ya existe una cuenta con este correo" });

    let slug = slugify(input.businessName);
    const slugTaken = await cdb.select({ id: control.tenants.id }).from(control.tenants).where(eq(control.tenants.slug, slug)).get();
    if (slugTaken) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;

    const tenantId = newId();
    const userId = newId();
    const dbBinding = "DB_TENANT_DEFAULT";
    const passwordHash = await hashPassword(input.password);

    // 1. Control DB: tenant (provisioning), user and owner membership, atomically.
    await cdb.batch([
      cdb.insert(control.tenants).values({ id: tenantId, slug, name: input.businessName, dbBinding, status: "provisioning" }),
      cdb.insert(control.users).values({ id: userId, email: input.email, name: input.ownerName, passwordHash }),
      cdb.insert(control.memberships).values({ tenantId, userId, role: "owner" }),
    ]);

    // 2. Business DB: settings, default location and tax, plus the audit entry, atomically.
    try {
      const { db } = getTenantDb(c.env, { dbBinding });
      await db.batch([
        db.insert(tenant.businessSettings).values({ tenantId, tradeName: input.businessName, currency: input.currency, timezone: input.timezone }),
        db.insert(tenant.locations).values({ id: newId(), tenantId, name: "Tienda principal", type: "store", isDefault: true }),
        db.insert(tenant.taxRates).values({ id: newId(), tenantId, name: "Sin impuesto", rateBps: 0, isDefault: true }),
        db.insert(tenant.auditLog).values({
          id: newId(), tenantId, userId, userName: input.ownerName, action: "tenant.create", entity: "tenant", entityId: tenantId,
          after: { name: input.businessName, slug }, ip: c.req.header("cf-connecting-ip") ?? null,
        }),
      ]);
    } catch (err) {
      // Undo step 1 so the email can be used again.
      await cdb.batch([
        cdb.delete(control.memberships).where(eq(control.memberships.tenantId, tenantId)),
        cdb.delete(control.users).where(eq(control.users.id, userId)),
        cdb.delete(control.tenants).where(eq(control.tenants.id, tenantId)),
      ]);
      throw err;
    }

    // 3. Activate and sign in.
    await cdb.update(control.tenants).set({ status: "active" }).where(eq(control.tenants.id, tenantId));
    await createSession(c, userId, tenantId);
    return c.json(
      { user: { id: userId, name: input.ownerName, email: input.email }, tenant: { id: tenantId, slug, name: input.businessName }, role: "owner" },
      201,
    );
  })

  .post("/login", json(loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const cdb = controlDb(c.env.DB_CONTROL);
    const ip = c.req.header("cf-connecting-ip") ?? null;

    const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000).toISOString();
    const [failed] = await cdb
      .select({ n: count() })
      .from(control.loginAttempts)
      .where(and(eq(control.loginAttempts.email, email), eq(control.loginAttempts.success, false), gt(control.loginAttempts.createdAt, since)));
    if ((failed?.n ?? 0) >= MAX_FAILED_LOGINS) {
      throw new AppError(429, "too_many_attempts", `Demasiados intentos. Espera ${LOCKOUT_MINUTES} minutos o restablece tu contraseña.`);
    }

    const user = await cdb.select().from(control.users).where(and(eq(control.users.email, email), isNull(control.users.deletedAt))).get();
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    await cdb.insert(control.loginAttempts).values({ email, ip, success: Boolean(user && ok) });
    if (!user || !ok) throw new AppError(401, "invalid_credentials", "Correo o contraseña incorrectos");

    // Most recent active membership in an active business.
    const membership = await cdb
      .select({ tenantId: control.memberships.tenantId, role: control.memberships.role, tenantName: control.tenants.name, slug: control.tenants.slug })
      .from(control.memberships)
      .innerJoin(control.tenants, eq(control.tenants.id, control.memberships.tenantId))
      .where(and(eq(control.memberships.userId, user.id), eq(control.memberships.active, true), eq(control.tenants.status, "active")))
      .orderBy(desc(control.memberships.createdAt))
      .get();
    if (!membership) throw new AppError(403, "no_active_business", "Tu acceso a este negocio está desactivado. Habla con el administrador.");

    await createSession(c, user.id, membership.tenantId);
    return c.json({
      user: { id: user.id, name: user.name, email: user.email },
      tenant: { id: membership.tenantId, slug: membership.slug, name: membership.tenantName },
      role: membership.role,
    });
  })

  .post("/logout", async (c) => {
    const session = await loadSession(c);
    if (session) await destroySession(c.env, session.sessionId);
    clearSessionCookie(c);
    return c.body(null, 204);
  })

  /** Always answers 204 so it cannot be used to discover which emails have an account. */
  .post("/password/forgot", json(forgotPasswordSchema), async (c) => {
    const { email } = c.req.valid("json");
    const cdb = controlDb(c.env.DB_CONTROL);
    const user = await cdb.select().from(control.users).where(and(eq(control.users.email, email), isNull(control.users.deletedAt))).get();
    if (!user) return c.body(null, 204);

    const token = randomToken();
    await cdb.insert(control.passwordResets).values({
      tokenHash: await sha256Hex(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000).toISOString(),
    });
    const url = `${c.env.APP_URL}/restablecer?token=${encodeURIComponent(token)}`;
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: user.email,
        subject: "Restablece tu contraseña de Nexo",
        text: `Hola ${user.name}:\n\nPara elegir una nueva contraseña abre este enlace (vence en ${RESET_TOKEN_MINUTES} minutos):\n${url}\n\nSi no lo pediste, ignora este correo.`,
      }),
    );
    // Development convenience only: lets you test the flow without an email provider.
    if (c.env.APP_ENV === "development") return c.json({ devResetUrl: url });
    return c.body(null, 204);
  })

  .post("/password/reset", json(resetPasswordSchema), async (c) => {
    const { token, password } = c.req.valid("json");
    const cdb = controlDb(c.env.DB_CONTROL);
    const tokenHash = await sha256Hex(token);
    const reset = await cdb
      .select()
      .from(control.passwordResets)
      .where(and(eq(control.passwordResets.tokenHash, tokenHash), isNull(control.passwordResets.usedAt), gt(control.passwordResets.expiresAt, new Date().toISOString())))
      .get();
    if (!reset) throw new AppError(400, "invalid_token", "El enlace no es válido o ya venció. Solicita uno nuevo.");

    const user = await cdb.select({ email: control.users.email }).from(control.users).where(eq(control.users.id, reset.userId)).get();
    const usedAt = new Date().toISOString();
    await cdb.batch([
      // A successful reset lifts any login lockout.
      cdb.delete(control.loginAttempts).where(eq(control.loginAttempts.email, user?.email ?? "")),
      cdb.update(control.users).set({ passwordHash: await hashPassword(password) }).where(eq(control.users.id, reset.userId)),
      cdb.update(control.passwordResets).set({ usedAt }).where(eq(control.passwordResets.userId, reset.userId)),
      cdb.delete(control.sessions).where(eq(control.sessions.userId, reset.userId)),
    ]);
    return c.body(null, 204);
  })

  .post(
    "/password/change",
    requireAuth,
    json(z.object({ currentPassword: z.string().min(1), newPassword: resetPasswordSchema.shape.password })),
    async (c) => {
      const { currentPassword, newPassword } = c.req.valid("json");
      const { user, tenant: t } = c.var.auth;
      const cdb = controlDb(c.env.DB_CONTROL);
      const row = await cdb.select({ hash: control.users.passwordHash }).from(control.users).where(eq(control.users.id, user.id)).get();
      if (!row || !(await verifyPassword(currentPassword, row.hash))) {
        throw new AppError(422, "validation_error", "Revisa los campos marcados", { currentPassword: "La contraseña actual no es correcta" });
      }
      await cdb.update(control.users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(control.users.id, user.id));
      // Sign out every other device, keep this one.
      await destroyUserSessions(c.env, user.id);
      await createSession(c, user.id, t.id);
      return c.body(null, 204);
    },
  );
