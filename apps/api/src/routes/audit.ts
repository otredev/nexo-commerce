import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import { tenant } from "@nexo/db";
import type { AppEnv } from "../env";
import { requirePermission } from "../middleware/auth";

const { auditLog } = tenant;

/** Paginated by cursor (the id of the last entry seen), newest first. */
export const auditRoutes = new Hono<AppEnv>().get("/", requirePermission("audit:read"), async (c) => {
  const { db, tenant: t } = c.var.auth;
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const cursor = c.req.query("cursor");
  const entity = c.req.query("entity");
  const filters = [eq(auditLog.tenantId, t.id)];
  if (cursor) filters.push(lt(auditLog.id, cursor));
  if (entity) filters.push(eq(auditLog.entity, entity));
  const rows = await db
    .select({
      id: auditLog.id, userId: auditLog.userId, userName: auditLog.userName, action: auditLog.action, entity: auditLog.entity,
      entityId: auditLog.entityId, before: auditLog.before, after: auditLog.after, createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(and(...filters))
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return c.json({ items, nextCursor: hasMore ? items[items.length - 1]!.id : null });
});
