/**
 * Push notifications to the people of a business (Phase 8).
 * Who receives an event: active members whose role has the event's permission and who did not turn it off.
 * Gone subscriptions (404/410) are deleted; one that keeps failing is dropped after 5 tries.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { control, controlDb } from "@nexo/db";
import { effectivePermissions, formatMoney, NOTIFICATION_EVENTS, type NotificationEvent, type Permission } from "@nexo/shared";
import type { Env } from "../env";
import { chunk } from "./inventory";
import { getTenantD1 } from "./tenant";
import { sendPush, type PushMessage } from "./webpush";

export const pushConfigured = (env: Env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
const vapid = (env: Env) => ({ publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY!, subject: env.VAPID_SUBJECT ?? `mailto:${env.EMAIL_FROM?.match(/<(.+)>/)?.[1] ?? "soporte@example.com"}` });

/** A message, or one per person according to what they may see. */
type Message = PushMessage | ((permissions: readonly Permission[]) => PushMessage | null);

export async function notify(env: Env, tenantId: string, event: NotificationEvent | "test", message: Message, opts: { userId?: string } = {}): Promise<number> {
  if (!pushConfigured(env)) return 0;
  const db = controlDb(env.DB_CONTROL);
  const permission = event === "test" ? null : NOTIFICATION_EVENTS.find((e) => e.id === event)!.permission;
  const members = await db
    .select({ userId: control.memberships.userId, role: control.memberships.role, custom: control.tenantRoles.permissions })
    .from(control.memberships)
    .innerJoin(control.users, eq(control.users.id, control.memberships.userId))
    .leftJoin(control.tenantRoles, eq(control.tenantRoles.id, control.memberships.roleId))
    .where(and(eq(control.memberships.tenantId, tenantId), eq(control.memberships.active, true), isNull(control.users.deletedAt)));
  let people = members
    .map((m) => ({ userId: m.userId, permissions: effectivePermissions(m.role, m.custom) }))
    .filter((m) => (!permission || m.permissions.includes(permission)) && (!opts.userId || m.userId === opts.userId));
  if (!people.length) return 0;
  if (event !== "test") {
    const prefs = await db.select().from(control.notificationPrefs).where(and(eq(control.notificationPrefs.tenantId, tenantId), inArray(control.notificationPrefs.userId, people.map((p) => p.userId))));
    people = people.filter((p) => prefs.find((x) => x.userId === p.userId)?.prefs[event] !== false);
  }
  let sent = 0;
  for (const part of chunk(people, 80)) {
    const subs = await db.select().from(control.pushSubscriptions).where(and(eq(control.pushSubscriptions.tenantId, tenantId), inArray(control.pushSubscriptions.userId, part.map((p) => p.userId))));
    await Promise.all(
      subs.map(async (s) => {
        const perms = part.find((p) => p.userId === s.userId)!.permissions;
        const msg = typeof message === "function" ? message(perms) : message;
        if (!msg) return;
        let status = 0;
        try {
          status = await sendPush(s, msg, vapid(env), { urgency: event === "order_new" || event === "order_paid" ? "high" : "normal" });
        } catch (err) {
          console.error("[push] send", err);
        }
        const now = new Date().toISOString();
        if (status >= 200 && status < 300) {
          sent++;
          await db.update(control.pushSubscriptions).set({ lastSentAt: now, failures: 0 }).where(eq(control.pushSubscriptions.id, s.id));
        } else if (status === 404 || status === 410 || s.failures >= 4) {
          await db.delete(control.pushSubscriptions).where(eq(control.pushSubscriptions.id, s.id));
        } else {
          await db.update(control.pushSubscriptions).set({ failures: s.failures + 1 }).where(eq(control.pushSubscriptions.id, s.id));
        }
      }),
    );
  }
  return sent;
}

/* ---------- Morning digest (hourly cron; sent at 8:00 in each business's time zone) ---------- */

const localHour = (tz: string, at: Date) => {
  try { return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at)); } catch { return -1; }
};

export async function dailyDigest(env: Env, at = new Date(), opts: { force?: boolean; tenantId?: string } = {}) {
  if (!pushConfigured(env)) return 0;
  const tenants = await controlDb(env.DB_CONTROL)
    .select({ id: control.tenants.id, dbBinding: control.tenants.dbBinding })
    .from(control.tenants)
    .where(opts.tenantId ? eq(control.tenants.id, opts.tenantId) : eq(control.tenants.status, "active"));
  let sent = 0;
  for (const t of tenants) {
    const subs = await env.DB_CONTROL.prepare("SELECT 1 AS ok FROM push_subscriptions WHERE tenant_id = ?1 LIMIT 1").bind(t.id).first();
    if (!subs) continue;
    let d1: D1Database;
    try { d1 = getTenantD1(env, t); } catch { continue; }
    const biz = await d1.prepare("SELECT timezone, currency, locale FROM business_settings WHERE tenant_id = ?1").bind(t.id).first<{ timezone: string; currency: string; locale: string }>();
    if (!biz || (!opts.force && localHour(biz.timezone, at) !== 8)) continue;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: biz.timezone }).format(at);
    const row = await d1
      .prepare(
        `WITH st AS (SELECT variant_id, SUM(quantity) AS qty FROM stock_levels WHERE tenant_id = ?1 GROUP BY variant_id)
         SELECT
           (SELECT COUNT(*) FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN st ON st.variant_id = v.id
             WHERE v.tenant_id = ?1 AND v.deleted_at IS NULL AND v.active = 1 AND p.deleted_at IS NULL AND p.status = 'active' AND p.track_inventory = 1
               AND (COALESCE(st.qty, 0) <= 0 OR (v.min_stock > 0 AND COALESCE(st.qty, 0) <= v.min_stock))) AS low,
           (SELECT COUNT(*) FROM purchase_receipts WHERE tenant_id = ?1 AND amount_due_cents > paid_cents AND due_date IS NOT NULL AND due_date <= ?2) AS due,
           (SELECT COALESCE(SUM(amount_due_cents - paid_cents), 0) FROM purchase_receipts WHERE tenant_id = ?1 AND amount_due_cents > paid_cents AND due_date IS NOT NULL AND due_date <= ?2) AS due_cents`,
      )
      .bind(t.id, today)
      .first<{ low: number; due: number; due_cents: number }>();
    if (!row || (!row.low && !row.due)) continue;
    const lowText = row.low ? `${row.low} ${row.low === 1 ? "producto necesita" : "productos necesitan"} resurtirse` : null;
    const dueText = row.due ? `${row.due} ${row.due === 1 ? "factura vence" : "facturas vencen"} hoy o ya vencieron (${formatMoney(row.due_cents, biz.currency, biz.locale)})` : null;
    sent += await notify(env, t.id, "daily_digest", (perms) => {
      const parts = [lowText, perms.includes("payables:read") ? dueText : null].filter(Boolean) as string[];
      if (!parts.length) return null;
      return { title: "Resumen de hoy", body: parts.join(" · "), url: lowText ? "/inventario?stock=low" : "/cuentas-por-pagar?estado=overdue", tag: `digest-${today}` };
    });
  }
  return sent;
}
