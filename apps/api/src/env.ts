import type { Role } from "@nexo/shared";
import type { TenantDb } from "@nexo/db";

export interface Env {
  APP_ENV: "development" | "staging" | "production";
  /** Public URL of the dashboard, used to build links in emails. */
  APP_URL: string;
  DB_CONTROL: D1Database;
  DB_TENANT_DEFAULT: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** Optional: API key of the transactional email provider (Resend). Without it, emails are logged. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export interface TenantRef {
  id: string;
  slug: string;
  name: string;
  dbBinding: string;
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  tenant: TenantRef;
  role: Role;
  /** Drizzle client bound to the D1 that stores this tenant. */
  db: TenantDb;
  /** Raw D1 handle of the same database, for batch(). */
  d1: D1Database;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};
