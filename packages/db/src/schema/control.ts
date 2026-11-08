/**
 * CONTROL database (binding DB_CONTROL).
 * Platform-level data: which businesses exist, who the users are, and which database holds each business.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Name of the Worker binding of the D1 that stores this business. Lets us move tenants to their own D1 later. */
    dbBinding: text("db_binding").notNull().default("DB_TENANT_DEFAULT"),
    /**
     * provisioning → active. suspended: blocked by the platform (no dashboard, no store).
     * migrating: being moved to another D1 (requests answer 503 for a moment).
     */
    status: text("status", { enum: ["provisioning", "active", "suspended", "migrating"] }).notNull().default("provisioning"),
    plan: text("plan").notNull().default("free"),
    /** Subscription state as Stripe reports it (Phase 6). */
    planStatus: text("plan_status", { enum: ["active", "trialing", "past_due", "canceled"] }).notNull().default("active"),
    planPeriodEnd: text("plan_period_end"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Stripe Connect account of the business, for card payments in its online store. */
    stripeAccountId: text("stripe_account_id"),
    stripeChargesEnabled: integer("stripe_charges_enabled", { mode: "boolean" }).notNull().default(false),
    suspendedReason: text("suspended_reason"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("tenants_slug_uq").on(t.slug), index("tenants_stripe_customer_idx").on(t.stripeCustomerId), index("tenants_stripe_account_idx").on(t.stripeAccountId)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull().default(now),
    deletedAt: text("deleted_at"),
    /** Blocked by the platform (/admin → Usuarios): cannot sign in anywhere until enabled again. */
    disabledAt: text("disabled_at"),
    lastLoginAt: text("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "admin", "cashier"] }).notNull(),
    /** Custom role of the business (tenant_roles): its permissions replace the built-in role's. Never on the owner. */
    roleId: text("role_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("memberships_user_idx").on(t.userId), index("memberships_role_idx").on(t.tenantId, t.roleId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token. The raw token only lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    expiresAt: text("expires_at").notNull(),
    userAgent: text("user_agent"),
    /** Support access: an operator entered the business as its owner (cookie nx_support, short-lived). */
    operatorId: text("operator_id"),
    operatorName: text("operator_name"),
    ticketId: text("ticket_id"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const passwordResets = sqliteTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    ip: text("ip"),
    success: integer("success", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt)],
);

/** Hostnames that point to a tenant's online store (Cloudflare for SaaS custom hostnames, Phase 6). */
export const tenantDomains = sqliteTable(
  "tenant_domains",
  {
    hostname: text("hostname").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    /** Id of the custom hostname in Cloudflare. */
    cfId: text("cf_id"),
    /** pending → active (DNS points to us and the certificate is issued) or failed. */
    status: text("status", { enum: ["pending", "active", "failed"] }).notNull().default("pending"),
    sslStatus: text("ssl_status"),
    /** DNS records the customer must add, as Cloudflare reports them. */
    verification: text("verification", { mode: "json" }).$type<Array<{ type: string; name: string; value: string }>>(),
    lastError: text("last_error"),
    checkedAt: text("checked_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("tenant_domains_tenant_idx").on(t.tenantId)],
);

/** Stripe webhook events already processed (Stripe retries; each event is applied once). */
export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

/** Browsers (phones, computers) that receive push notifications for a user in a business (Phase 8). */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Short device label shown in the list ("iPhone · Safari"). */
    device: text("device"),
    failures: integer("failures").notNull().default(0),
    lastSentAt: text("last_sent_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint), index("push_subscriptions_tenant_idx").on(t.tenantId, t.userId)],
);

/** Which notifications each person wants, per business. Missing row / key = on. */
export const notificationPrefs = sqliteTable(
  "notification_prefs",
  {
    userId: text("user_id").notNull().references(() => users.id),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    prefs: text("prefs", { mode: "json" }).$type<Record<string, boolean>>().notNull().default(sql`'{}'`),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tenantId] })],
);

/**
 * API keys of a business (Phase 11), for integrations and AI assistants (MCP). Only the SHA-256 of
 * the key is stored; the key itself is shown once. A key acts with a role (admin or cashier, never
 * owner) and can be read-only.
 */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    access: text("access", { enum: ["read", "full", "pos"] }).notNull(),
    createdBy: text("created_by").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: text("created_at").notNull().default(now),
    lastUsedAt: text("last_used_at"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.hash), index("api_keys_tenant_idx").on(t.tenantId)],
);

/* ---------- Platform administration (/admin): operators, their sessions and log, support tickets ---------- */

/**
 * People who run the platform. Separate from business users: their own sign-in, no business.
 * The first one is created with `node scripts/crear-operador.mjs <env>`; the rest from /admin.
 */
export const platformOperators = sqliteTable(
  "platform_operators",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** What they can do in /admin (PLATFORM_PERMISSIONS). ["*"] = everything. */
    permissions: text("permissions", { mode: "json" }).$type<string[]>().notNull().default(sql`'["*"]'`),
    lastLoginAt: text("last_login_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("platform_operators_email_uq").on(t.email)],
);

export const platformSessions = sqliteTable(
  "platform_sessions",
  {
    /** SHA-256 of the token in the nx_platform cookie. */
    id: text("id").primaryKey(),
    operatorId: text("operator_id").notNull().references(() => platformOperators.id),
    expiresAt: text("expires_at").notNull(),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("platform_sessions_operator_idx").on(t.operatorId)],
);

/** Everything operators do: sign-ins, suspensions, plan changes, entering a business, ticket replies… */
export const platformAudit = sqliteTable(
  "platform_audit",
  {
    id: text("id").primaryKey(),
    operatorId: text("operator_id"),
    operatorName: text("operator_name").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    tenantId: text("tenant_id"),
    /** Short human summary ("Plan: Gratis → Pro"). */
    summary: text("summary"),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("platform_audit_created_idx").on(t.createdAt), index("platform_audit_tenant_idx").on(t.tenantId, t.createdAt), index("platform_audit_operator_idx").on(t.operatorId, t.createdAt)],
);

/** Support tickets opened by a business from its panel, answered from /admin. */
export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    /** Platform-wide sequential number (#1024). */
    number: integer("number").notNull(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    createdBy: text("created_by").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdByEmail: text("created_by_email").notNull(),
    subject: text("subject").notNull(),
    category: text("category", { enum: ["question", "problem", "billing", "suggestion"] }).notNull().default("question"),
    priority: text("priority", { enum: ["normal", "high", "urgent"] }).notNull().default("normal"),
    /** open: waiting for support · waiting: support answered, waiting for the business · closed. */
    status: text("status", { enum: ["open", "waiting", "closed"] }).notNull().default("open"),
    /** The business lets support enter its account to look into this ticket. */
    allowAccess: integer("allow_access", { mode: "boolean" }).notNull().default(false),
    assignedTo: text("assigned_to").references(() => platformOperators.id),
    lastMessageAt: text("last_message_at").notNull().default(now),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("support_tickets_number_uq").on(t.number), index("support_tickets_tenant_idx").on(t.tenantId, t.lastMessageAt), index("support_tickets_status_idx").on(t.status, t.lastMessageAt)],
);

export const supportMessages = sqliteTable(
  "support_messages",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull().references(() => supportTickets.id),
    /** user: someone from the business · operator: support · system: automatic notes (support entered the account…). */
    authorType: text("author_type", { enum: ["user", "operator", "system"] }).notNull(),
    authorId: text("author_id"),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    /** Internal note between operators; the business never sees it. */
    internal: integer("internal", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("support_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

/**
 * Roles a business creates for its people ("Encargado", "Almacenista"…). Kept with the memberships so a
 * session resolves its permissions in the same query. Permissions are Permission ids from @nexo/shared.
 */
export const tenantRoles = sqliteTable(
  "tenant_roles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("tenant_roles_name_uq").on(t.tenantId, t.name)],
);
