import type { Env } from "./env";
import { tenantBindings } from "./lib/moveTenant";

const PAGE = 1000;
const RETENTION_DAYS = 30;

/**
 * Daily logical backup of every table of every database to R2, as NDJSON.
 * D1 Time Travel already covers 30 days of point-in-time recovery; this is our own off-database copy.
 * Fine for the MVP's small databases. For large ones, switch to `wrangler d1 export` in CI.
 */
export async function runBackup(env: Env): Promise<{ prefix: string; tables: number; rows: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const prefix = `backups/${day}`;
  let tables = 0;
  let rows = 0;

  // Control plus every tenant database (businesses may live in several D1s).
  const dbs: Array<[string, D1Database]> = [
    ["control", env.DB_CONTROL],
    ...tenantBindings(env).map((b): [string, D1Database] => [b.replace(/^DB_/, "").toLowerCase().replaceAll("_", "-"), (env as unknown as Record<string, D1Database>)[b]!]),
  ];
  for (const [name, d1] of dbs) {
    const { results } = await d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'")
      .all<{ name: string }>();
    for (const { name: table } of results) {
      const lines: string[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = await d1.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).bind(PAGE, offset).all();
        for (const row of page.results) lines.push(JSON.stringify(row));
        if (page.results.length < PAGE) break;
      }
      await env.BUCKET.put(`${prefix}/${name}/${table}.ndjson`, lines.join("\n"), {
        httpMetadata: { contentType: "application/x-ndjson" },
      });
      tables++;
      rows += lines.length;
    }
  }
  await pruneOldBackups(env);
  return { prefix, tables, rows };
}

async function pruneOldBackups(env: Env) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  let cursor: string | undefined;
  do {
    const list = await env.BUCKET.list({ prefix: "backups/", cursor });
    const stale = list.objects.map((o) => o.key).filter((key) => (key.split("/")[1] ?? "") < cutoff);
    if (stale.length) await env.BUCKET.delete(stale);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

/** Housekeeping of short-lived rows in the control DB. */
export async function cleanupControl(env: Env) {
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await env.DB_CONTROL.batch([
    env.DB_CONTROL.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB_CONTROL.prepare("DELETE FROM platform_sessions WHERE expires_at < ?").bind(now),
    env.DB_CONTROL.prepare("DELETE FROM password_resets WHERE expires_at < ?").bind(weekAgo),
    env.DB_CONTROL.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(weekAgo),
  ]);
}
