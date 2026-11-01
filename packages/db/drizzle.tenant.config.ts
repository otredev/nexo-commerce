import { defineConfig } from "drizzle-kit";

/**
 * Business (tenant) database: every business-owned table, all with tenant_id.
 * Today all tenants share one D1; the same migrations will run on each per-tenant D1 later.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/tenant.ts",
  out: "./migrations/tenant",
});
