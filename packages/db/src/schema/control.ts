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
    /** provisioning → active. A tenant stays in provisioning until its business DB is seeded. */
    status: text("status", { enum: ["provisioning", "active", "suspended"] }).notNull().default("provisioning"),
    plan: text("plan").notNull().default("free"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("tenants_slug_uq").on(t.slug)],
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
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "admin", "cashier"] }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("memberships_user_idx").on(t.userId)],
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

/** Hostnames that point to a tenant's online store (Phase 4). */
export const tenantDomains = sqliteTable("tenant_domains", {
  hostname: text("hostname").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  createdAt: text("created_at").notNull().default(now),
});
