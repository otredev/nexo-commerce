import { drizzle } from "drizzle-orm/d1";
import * as control from "./schema/control";
import * as tenant from "./schema/tenant";

export { control, tenant };

export function controlDb(d1: D1Database) {
  return drizzle(d1, { schema: control });
}

export function tenantDb(d1: D1Database) {
  return drizzle(d1, { schema: tenant });
}

export type ControlDb = ReturnType<typeof controlDb>;
export type TenantDb = ReturnType<typeof tenantDb>;
