/**
 * Moves one business to another D1 (e.g. its own database for a large customer).
 * 1. status = migrating: the dashboard answers 503 and the store 404 for the duration.
 * 2. Copies every row with tenant_id = ? table by table, in creation order (parents before children).
 * 3. Verifies row counts, points tenants.db_binding to the new database and reactivates it.
 * 4. Deletes the rows from the old database.
 * If anything fails before step 3, the copy is removed from the target and the business stays where it was.
 * Fits small and medium businesses in one request; a very large one should be moved with `wrangler d1 export`.
 */
import { eq } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import type { Env } from "../env";
import { AppError } from "./errors";
import { getTenantD1 } from "./tenant";

const READ_PAGE = 500;
const WRITE_BATCH = 50;

/** Every D1 binding that can hold businesses. */
export const tenantBindings = (env: Env) =>
  Object.keys(env)
    .filter((k) => /^DB_TENANT_[A-Z0-9_]+$/.test(k) && typeof (env as unknown as Record<string, D1Database>)[k]?.prepare === "function")
    .sort();

async function tenantTables(d1: D1Database) {
  const { results } = await d1
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY rowid")
    .all<{ name: string }>();
  const tables: Array<{ name: string; columns: string[] }> = [];
  for (const { name } of results) {
    const cols = await d1.prepare(`PRAGMA table_info("${name}")`).all<{ name: string }>();
    const columns = cols.results.map((c) => c.name);
    if (columns.includes("tenant_id")) tables.push({ name, columns });
  }
  return tables;
}

async function deleteTenantRows(d1: D1Database, tables: Array<{ name: string }>, tenantId: string) {
  // Children first.
  await d1.batch([d1.prepare("PRAGMA defer_foreign_keys = on"), ...[...tables].reverse().map((t) => d1.prepare(`DELETE FROM "${t.name}" WHERE tenant_id = ?1`).bind(tenantId))]);
}

export async function moveTenant(env: Env, tenantId: string, targetBinding: string) {
  const cdb = controlDb(env.DB_CONTROL);
  const tenant = await cdb.select().from(control.tenants).where(eq(control.tenants.id, tenantId)).get();
  if (!tenant) throw new AppError(404, "not_found", "Negocio no encontrado");
  if (tenant.dbBinding === targetBinding) throw new AppError(409, "same_database", "El negocio ya está en esa base de datos.");
  if (!tenantBindings(env).includes(targetBinding)) throw new AppError(422, "validation_error", `No existe la base de datos ${targetBinding} en este entorno.`, { binding: "Binding no configurado" });
  if (tenant.status !== "active" && tenant.status !== "suspended") throw new AppError(409, "busy", "El negocio no está en un estado que permita moverlo.");

  const source = getTenantD1(env, tenant);
  const target = getTenantD1(env, { dbBinding: targetBinding });
  const sourceTables = await tenantTables(source);
  const targetTables = new Map((await tenantTables(target)).map((t) => [t.name, t.columns]));
  const missing = sourceTables.filter((t) => !targetTables.has(t.name)).map((t) => t.name);
  if (missing.length) throw new AppError(409, "schema_mismatch", `La base de datos destino no tiene las tablas ${missing.join(", ")}. Aplica las migraciones primero.`);

  const previousStatus = tenant.status;
  await cdb.update(control.tenants).set({ status: "migrating" }).where(eq(control.tenants.id, tenantId));
  const started = Date.now();
  const counts: Record<string, number> = {};
  try {
    // Leftovers of a failed earlier attempt.
    await deleteTenantRows(target, sourceTables, tenantId);
    for (const table of sourceTables) {
      const columns = table.columns.filter((c) => targetTables.get(table.name)!.includes(c));
      const list = columns.map((c) => `"${c}"`).join(", ");
      const insert = `INSERT INTO "${table.name}" (${list}) VALUES (${columns.map((_, i) => `?${i + 1}`).join(", ")})`;
      let copied = 0;
      for (let offset = 0; ; offset += READ_PAGE) {
        const page = await source.prepare(`SELECT ${list} FROM "${table.name}" WHERE tenant_id = ?1 ORDER BY rowid LIMIT ${READ_PAGE} OFFSET ${offset}`).bind(tenantId).all<Record<string, unknown>>();
        for (let i = 0; i < page.results.length; i += WRITE_BATCH) {
          const rows = page.results.slice(i, i + WRITE_BATCH);
          await target.batch([target.prepare("PRAGMA defer_foreign_keys = on"), ...rows.map((r) => target.prepare(insert).bind(...columns.map((c) => r[c] ?? null)))]);
        }
        copied += page.results.length;
        if (page.results.length < READ_PAGE) break;
      }
      const check = await target.prepare(`SELECT COUNT(*) AS n FROM "${table.name}" WHERE tenant_id = ?1`).bind(tenantId).first<{ n: number }>();
      if ((check?.n ?? -1) !== copied) throw new Error(`count mismatch in ${table.name}: ${check?.n} != ${copied}`);
      counts[table.name] = copied;
    }
  } catch (err) {
    console.error("[move] failed, rolling back", tenantId, err);
    await deleteTenantRows(target, sourceTables, tenantId).catch((e) => console.error("[move] cleanup", e));
    await cdb.update(control.tenants).set({ status: previousStatus }).where(eq(control.tenants.id, tenantId));
    throw new AppError(500, "move_failed", `No se pudo mover el negocio: ${(err as Error).message}`);
  }
  await cdb.update(control.tenants).set({ dbBinding: targetBinding, status: previousStatus }).where(eq(control.tenants.id, tenantId));
  await deleteTenantRows(source, sourceTables, tenantId).catch((e) => console.error("[move] old rows left in", tenant.dbBinding, e));
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  return { from: tenant.dbBinding, to: targetBinding, tables: Object.keys(counts).length, rows, ms: Date.now() - started };
}
