import type { Context } from "hono";
import { and, count, eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { LIMIT_LABELS, planOf, withinLimit, type LimitKey, type PlanId } from "@nexo/shared";
import type { AppEnv, Env } from "../env";
import { AppError } from "./errors";

export interface Usage { users: number; locations: number; products: number }

/** What the business uses of each limited resource. */
export async function usageOf(env: Env, tenantId: string, d1: D1Database): Promise<Usage> {
  const [members, rows] = await Promise.all([
    controlDb(env.DB_CONTROL)
      .select({ n: count() })
      .from(control.memberships)
      .where(and(eq(control.memberships.tenantId, tenantId), eq(control.memberships.active, true)))
      .get(),
    d1
      .prepare(
        `SELECT (SELECT COUNT(*) FROM locations WHERE tenant_id = ?1 AND active = 1) AS locations,
                (SELECT COUNT(*) FROM products WHERE tenant_id = ?1 AND deleted_at IS NULL) AS products`,
      )
      .bind(tenantId)
      .first<{ locations: number; products: number }>(),
  ]);
  return { users: members?.n ?? 0, locations: rows?.locations ?? 0, products: rows?.products ?? 0 };
}

export const planLimitError = (plan: PlanId, key: LimitKey, limit: number) =>
  new AppError(
    402,
    "plan_limit",
    `Tu plan ${planOf(plan).name} permite hasta ${limit.toLocaleString("es-MX")} ${limit === 1 ? LIMIT_LABELS[key].one : LIMIT_LABELS[key].many}. Mejora tu plan en Configuración › Plan para agregar más.`,
    { limit: key },
  );

/** Throws 402 when adding `adding` more of `key` goes over the plan. Existing data above a lower plan stays. */
export async function assertWithinLimit(c: Context<AppEnv>, key: LimitKey, adding = 1) {
  const { tenant: t, d1 } = c.var.auth;
  const limit = planOf(t.plan).limits[key];
  if (limit === null) return;
  const usage = await usageOf(c.env, t.id, d1);
  if (!withinLimit(limit, usage[key], adding)) throw planLimitError(t.plan, key, limit);
}

/** How many more `key` the plan allows (Infinity when unlimited). */
export async function remaining(c: Context<AppEnv>, key: LimitKey) {
  const { tenant: t, d1 } = c.var.auth;
  const limit = planOf(t.plan).limits[key];
  if (limit === null) return Number.POSITIVE_INFINITY;
  return Math.max(limit - (await usageOf(c.env, t.id, d1))[key], 0);
}

export function assertFeature(c: Context<AppEnv>, feature: "cardPayments" | "customDomain") {
  const plan = planOf(c.var.auth.tenant.plan);
  if (!plan.limits[feature]) {
    throw new AppError(402, "plan_feature", `${feature === "cardPayments" ? "El cobro con tarjeta" : "El dominio propio"} está disponible desde el plan Pro. Mejora tu plan en Configuración › Plan.`, { feature });
  }
}
