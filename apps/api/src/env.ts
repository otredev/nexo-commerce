import type { Role } from "@nexo/shared";
import type { TenantDb } from "@nexo/db";

export interface Env {
  APP_ENV: "development" | "staging" | "production";
  /** Public URL of the dashboard, used to build links in emails. */
  APP_URL: string;
  /** Public URL of the online store (Cloudflare Pages), used in order links. */
  STORE_URL: string;
  DB_CONTROL: D1Database;
  DB_TENANT_DEFAULT: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** Optional: API key of the transactional email provider (Resend). Without it, emails are logged. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;

  /* ---------- Phase 6: SaaS (all optional: without them the feature reports "not configured") ---------- */
  /** Comma-separated emails of the platform operators (super-admin panel). */
  PLATFORM_ADMINS?: string;
  /** Stripe secret key (sk_live_… / sk_test_…). */
  STRIPE_SECRET_KEY?: string;
  /** Signing secret of the webhook endpoint for platform events (subscriptions). */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Signing secret of the Connect webhook endpoint (events from the businesses' accounts). */
  STRIPE_CONNECT_WEBHOOK_SECRET?: string;
  /** Price ids of the monthly plans. */
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_BUSINESS?: string;
  /** Optional platform fee on each store card payment, in basis points (100 = 1%). */
  STRIPE_APPLICATION_FEE_BPS?: string;
  /** Override of https://api.stripe.com (tests point it to a mock server). */
  STRIPE_API_BASE?: string;
  /** Cloudflare for SaaS: token with "SSL and Certificates: Edit" on the zone of the stores. */
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  /** Override of https://api.cloudflare.com/client/v4 (tests). */
  CF_API_BASE?: string;
  /** Hostname customers point their CNAME to (the fallback origin of the zone). */
  STORE_CNAME_TARGET?: string;
  /** Web Push (Phase 8): VAPID key pair (base64url) and contact. Generate with `node scripts/vapid-keys.mjs`. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Live customer displays paired with a register (Phase 8). */
  DISPLAY_HUB?: DurableObjectNamespace;
  /** Workers Analytics Engine dataset for store traffic (Phase 7). Optional: without it nothing is recorded. */
  STORE_EVENTS?: AnalyticsEngineDataset;
  /** Reading it back (Phase 10): Analytics Engine SQL API. Account id, a token with "Account Analytics: Read",
   *  and the dataset name of this environment. Without them the traffic part of the store report says "not configured". */
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  STORE_EVENTS_DATASET?: string;
}

export interface TenantRef {
  id: string;
  slug: string;
  name: string;
  dbBinding: string;
}

export interface TenantAuth extends TenantRef {
  status: "provisioning" | "active" | "suspended" | "migrating";
  /** Effective plan (a canceled subscription falls back to free). */
  plan: import("@nexo/shared").PlanId;
  suspendedReason: string | null;
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; name: string; email: string };
  tenant: TenantAuth;
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
