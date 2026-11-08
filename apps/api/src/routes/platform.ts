/**
 * Platform administration API (/api/platform), used by the /admin panel. Operators sign in with their
 * own accounts (cookie nx_platform), separate from business users. Everything they change is written
 * to the platform log, in the same batch as the change.
 */
import { Hono } from "hono";
import { and, count, desc, eq, gt, inArray, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { control, controlDb, tenant as tenantSchema } from "@nexo/db";
import {
  effectivePlan, moveTenantSchema, operatorCreateSchema, operatorPermissions, PLATFORM_PERMISSIONS, operatorLoginSchema, operatorPasswordSchema, operatorUpdateSchema, PLANS, platformTenantUpdateSchema,
  SUPPORT_ACCESS_MINUTES, supportAccessSchema, type OperatorMe, type PlatformAuditEntry, type PlatformOperator, type PlatformTenant, type PlatformTenantDetail,
} from "@nexo/shared";
import type { Env } from "../env";
import { hashPassword, newId, verifyPassword } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { moveTenant, tenantBindings } from "../lib/moveTenant";
import { clearOperatorCookie, createOperatorSession, inSlices, loadOperator, opCan, platformLogEntry, requireOp, requireOperator, type PlatformEnv } from "../lib/operator";
import { platformMetrics } from "../lib/platformMetrics";
import { usageOf } from "../lib/plan";
import { createSupportSession } from "../lib/session";
import { toTicket } from "../lib/support";
import { getTenantD1, getTenantDb } from "../lib/tenant";
import { json } from "../lib/validate";
import { platformTicketRoutes } from "./platformTickets";
import { platformUserRoutes } from "./platformUsers";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
/** Failed operator sign-ins share the login_attempts table under their own key. */
const attemptKey = (email: string) => `operator:${email}`;

/* ---------------- Businesses ---------------- */

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "suspended", "migrating", "provisioning"]).default("all"),
  plan: z.enum(["all", "free", "pro", "business"]).default("all"),
});

type TenantRow = typeof control.tenants.$inferSelect;

async function decorate(env: Env, rows: TenantRow[]): Promise<PlatformTenant[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const db = controlDb(env.DB_CONTROL);
  const [owners, members, domains, tickets] = await Promise.all([
    inSlices(ids, (slice) =>
      db
        .select({ tenantId: control.memberships.tenantId, name: control.users.name, email: control.users.email })
        .from(control.memberships)
        .innerJoin(control.users, eq(control.users.id, control.memberships.userId))
        .where(and(inArray(control.memberships.tenantId, slice), eq(control.memberships.role, "owner")))),
    inSlices(ids, (slice) =>
      db
        .select({ tenantId: control.memberships.tenantId, n: sql<number>`count(*)` })
        .from(control.memberships)
        .where(and(inArray(control.memberships.tenantId, slice), eq(control.memberships.active, true)))
        .groupBy(control.memberships.tenantId)),
    inSlices(ids, (slice) => db.select({ tenantId: control.tenantDomains.tenantId, hostname: control.tenantDomains.hostname }).from(control.tenantDomains).where(inArray(control.tenantDomains.tenantId, slice))),
    inSlices(ids, (slice) =>
      db
        .select({ tenantId: control.supportTickets.tenantId, n: sql<number>`count(*)` })
        .from(control.supportTickets)
        .where(and(inArray(control.supportTickets.tenantId, slice), sql`${control.supportTickets.status} <> 'closed'`))
        .groupBy(control.supportTickets.tenantId)),
  ]);
  return rows.map((r) => {
    const owner = owners.find((o) => o.tenantId === r.id);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      plan: effectivePlan(r.plan, r.planStatus),
      planStatus: r.planStatus,
      dbBinding: r.dbBinding,
      createdAt: r.createdAt,
      owner: owner ? { name: owner.name, email: owner.email } : null,
      members: members.find((m) => m.tenantId === r.id)?.n ?? 0,
      domains: domains.filter((d) => d.tenantId === r.id).map((d) => d.hostname),
      suspendedReason: r.suspendedReason,
      openTickets: tickets.find((t) => t.tenantId === r.id)?.n ?? 0,
    };
  });
}

async function tenantRow(env: Env, id: string) {
  const row = await controlDb(env.DB_CONTROL).select().from(control.tenants).where(eq(control.tenants.id, id)).get();
  if (!row) throw new AppError(404, "not_found", "Negocio no encontrado");
  return row;
}

async function detail(env: Env, id: string): Promise<PlatformTenantDetail> {
  const row = await tenantRow(env, id);
  const cdb = controlDb(env.DB_CONTROL);
  const [base] = await decorate(env, [row]);
  let usage: PlatformTenantDetail["usage"] = { users: base!.members, locations: 0, products: 0, sales30d: 0, sales30dCents: 0, orders30d: 0 };
  let currency = "MXN";
  if (row.status !== "migrating" && row.status !== "provisioning") {
    const d1 = getTenantD1(env, row);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [u, activity] = await Promise.all([
      usageOf(env, row.id, d1),
      d1
        .prepare(
          `SELECT (SELECT COUNT(*) FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND created_at >= ?2) AS sales,
                  (SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE tenant_id = ?1 AND status = 'completed' AND created_at >= ?2) AS cents,
                  (SELECT COUNT(*) FROM orders WHERE tenant_id = ?1 AND created_at >= ?2) AS orders,
                  (SELECT currency FROM business_settings WHERE tenant_id = ?1) AS currency`,
        )
        .bind(row.id, since)
        .first<{ sales: number; cents: number; orders: number; currency: string | null }>(),
    ]);
    usage = { ...u, sales30d: activity?.sales ?? 0, sales30dCents: activity?.cents ?? 0, orders30d: activity?.orders ?? 0 };
    currency = activity?.currency ?? "MXN";
  }
  const [members, tickets, log] = await Promise.all([
    cdb
      .select({ id: control.users.id, name: control.users.name, email: control.users.email, role: control.memberships.role, roleName: control.tenantRoles.name, active: control.memberships.active, disabledAt: control.users.disabledAt, lastLoginAt: control.users.lastLoginAt })
      .from(control.memberships)
      .innerJoin(control.users, eq(control.users.id, control.memberships.userId))
      .leftJoin(control.tenantRoles, eq(control.tenantRoles.id, control.memberships.roleId))
      .where(and(eq(control.memberships.tenantId, id), isNull(control.users.deletedAt))),
    cdb.select().from(control.supportTickets).where(eq(control.supportTickets.tenantId, id)).orderBy(desc(control.supportTickets.lastMessageAt)).limit(10),
    auditList(env, { tenantId: id, limit: 10 }),
  ]);
  const order = { owner: 0, admin: 1, cashier: 2 } as const;
  return {
    ...base!,
    usage,
    currency,
    stripeCustomerId: row.stripeCustomerId,
    stripeAccountId: row.stripeAccountId,
    planPeriodEnd: row.planPeriodEnd,
    availableBindings: tenantBindings(env),
    people: members.sort((a, b) => order[a.role] - order[b.role]).map((m) => ({ ...m, roleName: m.roleName ?? null, disabled: Boolean(m.disabledAt) })),
    tickets: tickets.map((t) => toTicket(t)),
    log,
  };
}

/* ---------------- Log ---------------- */

const auditQuery = z.object({
  operatorId: z.string().max(40).optional(),
  tenantId: z.string().max(40).optional(),
  entity: z.enum(["operator", "tenant", "user", "ticket"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

async function auditList(env: Env, q: { operatorId?: string; tenantId?: string; entity?: string; limit: number; offset?: number }) {
  const a = control.platformAudit;
  const where = and(q.operatorId ? eq(a.operatorId, q.operatorId) : undefined, q.tenantId ? eq(a.tenantId, q.tenantId) : undefined, q.entity ? eq(a.entity, q.entity) : undefined);
  const rows = await controlDb(env.DB_CONTROL)
    .select({ entry: a, tenantName: control.tenants.name })
    .from(a)
    .leftJoin(control.tenants, eq(control.tenants.id, a.tenantId))
    .where(where)
    .orderBy(desc(a.createdAt), desc(a.id))
    .limit(q.limit)
    .offset(q.offset ?? 0);
  return rows.map(({ entry: e, tenantName }): PlatformAuditEntry => ({ ...e, tenantName: tenantName ?? null, detail: e.detail ?? null }));
}

/* ---------------- Operators ---------------- */

const toOperator = (o: typeof control.platformOperators.$inferSelect): PlatformOperator => ({
  id: o.id, email: o.email, name: o.name, active: o.active, permissions: operatorPermissions(o.permissions), lastLoginAt: o.lastLoginAt, createdAt: o.createdAt,
});
const permissionsLabel = (p: readonly string[]) => (p.length === PLATFORM_PERMISSIONS.length ? "acceso completo" : `${p.length} permisos`);

const operatorRoutes = new Hono<PlatformEnv>()
  .get("/", async (c) => {
    const rows = await controlDb(c.env.DB_CONTROL).select().from(control.platformOperators).orderBy(desc(control.platformOperators.active), control.platformOperators.name);
    return c.json({ items: rows.map(toOperator) });
  })
  .post("/", requireOp("operators:manage"), json(operatorCreateSchema), async (c) => {
    const input = c.req.valid("json");
    const cdb = controlDb(c.env.DB_CONTROL);
    const taken = await cdb.select({ id: control.platformOperators.id }).from(control.platformOperators).where(eq(control.platformOperators.email, input.email)).get();
    if (taken) throw new AppError(409, "email_taken", "Ya existe un operador con este correo", { email: "Ya existe un operador con este correo" });
    const id = newId();
    await cdb.batch([
      cdb.insert(control.platformOperators).values({ id, email: input.email, name: input.name, passwordHash: await hashPassword(input.password), permissions: input.permissions ?? ["*"] }),
      platformLogEntry(c, { action: "operator.create", entity: "operator", entityId: id, summary: `${input.name} (${input.email}) · ${permissionsLabel(input.permissions ?? PLATFORM_PERMISSIONS)}` }),
    ]);
    return c.json(toOperator((await cdb.select().from(control.platformOperators).where(eq(control.platformOperators.id, id)).get())!), 201);
  })
  .patch("/:id", requireOp("operators:manage"), json(operatorUpdateSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const cdb = controlDb(c.env.DB_CONTROL);
    const row = await cdb.select().from(control.platformOperators).where(eq(control.platformOperators.id, id)).get();
    if (!row) throw new AppError(404, "not_found", "Operador no encontrado");
    if (input.active === false && id === c.var.operator.operator.id) throw new AppError(409, "self_disable", "No puedes desactivar tu propia cuenta.");
    if (input.password && id === c.var.operator.operator.id) throw new AppError(409, "own_password", "Cambia tu propia contraseña desde «Mi cuenta» (pide la actual).");
    if (input.permissions && id === c.var.operator.operator.id && !input.permissions.includes("operators:manage")) {
      throw new AppError(409, "self_lockout", "No puedes quitarte el permiso de administrar operadores: pídeselo a otro operador.");
    }
    const set = {
      ...(input.active !== undefined && { active: input.active }),
      ...(input.name && { name: input.name }),
      ...(input.password && { passwordHash: await hashPassword(input.password) }),
      ...(input.permissions && { permissions: input.permissions.length === PLATFORM_PERMISSIONS.length ? ["*"] : input.permissions }),
    };
    if (!Object.keys(set).length) return c.json(toOperator(row));
    const summary = [
      input.name && input.name !== row.name ? `Nombre: ${row.name} → ${input.name}` : null,
      input.active !== undefined && input.active !== row.active ? (input.active ? "Reactivado" : "Desactivado") : null,
      input.password ? "Contraseña nueva" : null,
      input.permissions ? `Permisos: ${permissionsLabel(input.permissions)}` : null,
    ].filter(Boolean).join(" · ");
    const signOut = input.active === false || Boolean(input.password);
    await cdb.batch([
      cdb.update(control.platformOperators).set(set).where(eq(control.platformOperators.id, id)),
      // Deactivated or new password: out at once (panel sessions and, if deactivated, any business they were inside).
      ...(signOut ? [cdb.delete(control.platformSessions).where(eq(control.platformSessions.operatorId, id))] : []),
      ...(input.active === false ? [cdb.delete(control.sessions).where(eq(control.sessions.operatorId, id))] : []),
      platformLogEntry(c, { action: "operator.update", entity: "operator", entityId: id, summary: `${row.name}: ${summary || "sin cambios"}` }),
    ] as unknown as Parameters<typeof cdb.batch>[0]);
    return c.json(toOperator((await cdb.select().from(control.platformOperators).where(eq(control.platformOperators.id, id)).get())!));
  });

/* ---------------- Businesses: routes ---------------- */

const tenantRoutes = new Hono<PlatformEnv>()
  .use("*", requireOp("tenants:read"))
  .get("/", async (c) => {
    const q = listQuery.parse(c.req.query());
    const t = control.tenants;
    const where = [
      q.status !== "all" ? eq(t.status, q.status) : undefined,
      q.plan !== "all" ? eq(t.plan, q.plan) : undefined,
      q.q ? or(like(t.name, `%${q.q}%`), like(t.slug, `%${q.q.toLowerCase()}%`), sql`${t.id} IN (SELECT m.tenant_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'owner' AND u.email LIKE ${`%${q.q.toLowerCase()}%`})`) : undefined,
    ].filter(Boolean);
    const rows = await controlDb(c.env.DB_CONTROL).select().from(t).where(where.length ? and(...where) : undefined).orderBy(desc(t.createdAt)).limit(200);
    const totals = await c.env.DB_CONTROL
      .prepare(`SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'suspended') AS suspended, SUM(plan <> 'free' AND plan_status <> 'canceled') AS paying FROM tenants WHERE status <> 'provisioning'`)
      .first<{ total: number; active: number; suspended: number; paying: number }>();
    return c.json({ items: await decorate(c.env, rows), totals: { total: totals?.total ?? 0, active: totals?.active ?? 0, suspended: totals?.suspended ?? 0, paying: totals?.paying ?? 0 } });
  })

  .get("/:id", async (c) => {
    const d = await detail(c.env, c.req.param("id"));
    // Tickets and the log only for whoever may read them.
    return c.json({ ...d, tickets: opCan(c, "support:read") ? d.tickets : [], log: opCan(c, "audit:read") ? d.log : [] });
  })

  /** Suspend / reactivate, and set the plan by hand (courtesy plans, agreements outside Stripe). */
  .patch("/:id", requireOp("tenants:manage"), json(platformTenantUpdateSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const db = controlDb(c.env.DB_CONTROL);
    const row = await tenantRow(c.env, id);
    if (row.status === "migrating" || row.status === "provisioning") throw new AppError(409, "busy", "Espera a que termine la operación en curso.");
    const set: Partial<TenantRow> = {};
    const logs: Array<ReturnType<typeof platformLogEntry>> = [];
    if (input.status && input.status !== row.status) {
      set.status = input.status;
      set.suspendedReason = input.status === "suspended" ? (input.suspendedReason ?? null) : null;
      logs.push(platformLogEntry(c, input.status === "suspended"
        ? { action: "tenant.suspend", entity: "tenant", entityId: id, tenantId: id, summary: input.suspendedReason ? `Motivo: ${input.suspendedReason}` : "Sin motivo" }
        : { action: "tenant.reactivate", entity: "tenant", entityId: id, tenantId: id }));
    }
    const current = effectivePlan(row.plan, row.planStatus);
    if (input.plan && input.plan !== current) {
      set.plan = input.plan;
      if (row.planStatus === "canceled" || !row.stripeSubscriptionId) set.planStatus = "active";
      logs.push(platformLogEntry(c, { action: "tenant.plan", entity: "tenant", entityId: id, tenantId: id, summary: `${PLANS[current].name} → ${PLANS[input.plan].name}` }));
    }
    if (logs.length) await db.batch([db.update(control.tenants).set(set).where(eq(control.tenants.id, id)), ...logs]);
    return c.json(await detail(c.env, id));
  })

  /** Moves the business to another D1 binding. */
  .post("/:id/move", requireOp("tenants:move"), json(moveTenantSchema), async (c) => {
    const { binding } = c.req.valid("json");
    const id = c.req.param("id");
    const before = await tenantRow(c.env, id);
    const result = await moveTenant(c.env, id, binding);
    await platformLogEntry(c, { action: "tenant.move", entity: "tenant", entityId: id, tenantId: id, summary: `${before.dbBinding} → ${binding} · ${result.rows.toLocaleString("es-MX")} registros`, detail: { ...result } });
    // Sessions keep working: the binding is read from the tenant on each request.
    return c.json({ result, tenant: await detail(c.env, id) });
  })

  /**
   * "Entrar como negocio": a short session inside the business as its owner, logged under the operator's
   * name everywhere (platform log, the business's activity and, from a ticket, the conversation).
   */
  .post("/:id/support-access", requireOp("tenants:enter"), json(supportAccessSchema), async (c) => {
    const id = c.req.param("id");
    const { reason, ticketId } = c.req.valid("json");
    const op = c.var.operator.operator;
    const cdb = controlDb(c.env.DB_CONTROL);
    const row = await tenantRow(c.env, id);
    if (row.status !== "active") throw new AppError(409, "not_active", row.status === "suspended" ? "El negocio está suspendido: reactívalo para entrar a su panel." : "El negocio no está disponible en este momento.");
    const ticket = ticketId ? await cdb.select().from(control.supportTickets).where(and(eq(control.supportTickets.id, ticketId), eq(control.supportTickets.tenantId, id))).get() : null;
    if (ticketId && !ticket) throw new AppError(404, "not_found", "Ticket no encontrado en este negocio");
    // Without the business's permission on a ticket, the operator must say why (the business sees it).
    if (!ticket?.allowAccess && reason.length < 10) throw new AppError(422, "validation_error", "Escribe el motivo para entrar", { reason: "Explica por qué entras (mínimo 10 caracteres). El negocio lo verá en su actividad." });
    const owner = await cdb
      .select({ id: control.users.id, name: control.users.name })
      .from(control.memberships)
      .innerJoin(control.users, eq(control.users.id, control.memberships.userId))
      .where(and(eq(control.memberships.tenantId, id), eq(control.memberships.role, "owner"), eq(control.memberships.active, true), isNull(control.users.deletedAt)))
      .get();
    if (!owner) throw new AppError(409, "no_owner", "El negocio no tiene un propietario activo.");

    const why = ticket ? `Ticket #${ticket.number}${reason ? ` · ${reason}` : ""}` : reason;
    const { db } = getTenantDb(c.env, row);
    await db.insert(tenantSchema.auditLog).values({
      id: newId(), tenantId: id, userId: owner.id, userName: `Soporte Nexo · ${op.name}`, action: "support.access", entity: "tenant", entityId: id,
      after: { operator: op.name, reason: why, minutes: SUPPORT_ACCESS_MINUTES }, ip: c.req.header("cf-connecting-ip") ?? null,
    });
    await cdb.batch([
      platformLogEntry(c, { action: "tenant.support_access", entity: "tenant", entityId: id, tenantId: id, summary: why }),
      ...(ticket ? [cdb.insert(control.supportMessages).values({ id: newId(), ticketId: ticket.id, authorType: "system", authorName: "Nexo", body: `${op.name} (soporte) entró a la cuenta para revisar este ticket.` })] : []),
    ] as unknown as Parameters<typeof cdb.batch>[0]);
    const expiresAt = await createSupportSession(c, { userId: owner.id, tenantId: id, operatorId: op.id, operatorName: op.name, ticketId: ticket?.id ?? null, minutes: SUPPORT_ACCESS_MINUTES });
    return c.json({ url: "/", expiresAt, owner: owner.name });
  });

/* ---------------- Router ---------------- */

const privateRoutes = new Hono<PlatformEnv>()
  .use("*", requireOperator)
  .get("/me", async (c) => {
    const [open] = await controlDb(c.env.DB_CONTROL).select({ n: count() }).from(control.supportTickets).where(eq(control.supportTickets.status, "open"));
    const body: OperatorMe = { operator: c.var.operator.operator, permissions: c.var.operator.permissions, openTickets: opCan(c, "support:read") ? (open?.n ?? 0) : 0 };
    return c.json(body);
  })
  .post("/auth/password", json(operatorPasswordSchema), async (c) => {
    const { currentPassword, newPassword } = c.req.valid("json");
    const op = c.var.operator;
    const cdb = controlDb(c.env.DB_CONTROL);
    const row = await cdb.select({ hash: control.platformOperators.passwordHash }).from(control.platformOperators).where(eq(control.platformOperators.id, op.operator.id)).get();
    if (!row || !(await verifyPassword(currentPassword, row.hash))) throw new AppError(422, "validation_error", "Revisa los campos marcados", { currentPassword: "La contraseña actual no es correcta" });
    await cdb.batch([
      cdb.update(control.platformOperators).set({ passwordHash: await hashPassword(newPassword) }).where(eq(control.platformOperators.id, op.operator.id)),
      // Other devices are signed out; this one stays.
      cdb.delete(control.platformSessions).where(and(eq(control.platformSessions.operatorId, op.operator.id), sql`${control.platformSessions.id} <> ${op.sessionId}`)),
      platformLogEntry(c, { action: "operator.password", entity: "operator", entityId: op.operator.id }),
    ]);
    return c.body(null, 204);
  })
  .get("/metrics", requireOp("metrics:read"), async (c) => c.json(await platformMetrics(c.env)))
  .get("/audit", requireOp("audit:read"), async (c) => {
    const q = auditQuery.parse(c.req.query());
    const a = control.platformAudit;
    const where = and(q.operatorId ? eq(a.operatorId, q.operatorId) : undefined, q.tenantId ? eq(a.tenantId, q.tenantId) : undefined, q.entity ? eq(a.entity, q.entity) : undefined);
    const [items, [total]] = await Promise.all([
      auditList(c.env, { ...q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize }),
      controlDb(c.env.DB_CONTROL).select({ n: count() }).from(a).where(where),
    ]);
    return c.json({ items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
  })
  .route("/operators", operatorRoutes)
  .route("/tenants", tenantRoutes)
  .route("/users", platformUserRoutes)
  .route("/tickets", platformTicketRoutes);

export const platformRoutes = new Hono<PlatformEnv>()
  .post("/auth/login", json(operatorLoginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const cdb = controlDb(c.env.DB_CONTROL);
    const ip = c.req.header("cf-connecting-ip") ?? null;
    const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000).toISOString();
    const [failed] = await cdb
      .select({ n: count() })
      .from(control.loginAttempts)
      .where(and(eq(control.loginAttempts.email, attemptKey(email)), eq(control.loginAttempts.success, false), gt(control.loginAttempts.createdAt, since)));
    if ((failed?.n ?? 0) >= MAX_FAILED_LOGINS) throw new AppError(429, "too_many_attempts", `Demasiados intentos. Espera ${LOCKOUT_MINUTES} minutos.`);

    const op = await cdb.select().from(control.platformOperators).where(eq(control.platformOperators.email, email)).get();
    const ok = (await verifyPassword(password, op?.passwordHash ?? DUMMY_HASH)) && Boolean(op?.active);
    await cdb.insert(control.loginAttempts).values({ email: attemptKey(email), ip, success: ok });
    if (!op || !ok) {
      // Failed attempts against a real operator account are worth seeing in the log.
      if (op) await platformLogEntry(c, { action: "operator.login_failed", entity: "operator", entityId: op.id, summary: op.active ? "Contraseña incorrecta" : "Cuenta desactivada" }, { id: op.id, name: op.name });
      throw new AppError(401, "invalid_credentials", "Correo o contraseña incorrectos");
    }
    await createOperatorSession(c, op.id);
    const now = new Date().toISOString();
    await cdb.batch([
      cdb.update(control.platformOperators).set({ lastLoginAt: now }).where(eq(control.platformOperators.id, op.id)),
      platformLogEntry(c, { action: "operator.login", entity: "operator", entityId: op.id }, { id: op.id, name: op.name }),
    ]);
    return c.json({ operator: { id: op.id, name: op.name, email: op.email } });
  })
  .post("/auth/logout", async (c) => {
    const auth = await loadOperator(c);
    if (auth) await controlDb(c.env.DB_CONTROL).delete(control.platformSessions).where(eq(control.platformSessions.id, auth.sessionId));
    clearOperatorCookie(c);
    return c.body(null, 204);
  })
  .route("/", privateRoutes);

