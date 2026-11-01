import { defineConfig } from "drizzle-kit";

/** Control database: tenants, users, memberships, sessions. One per environment. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/control.ts",
  out: "./migrations/control",
});
