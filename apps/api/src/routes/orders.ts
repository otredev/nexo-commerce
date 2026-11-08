import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import {
  businessDate,
  can,
  completeOrderSchema,
  formatMoney,
  ORDER_STATUSES,
  orderPaymentSchema,
  reasonSchema,
  type OrderDetail,
  type OrderListItem,
  type OrderStatus,
  type Paginated,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { emitEvent, emitFrom, orderData } from "../lib/outbound";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { isTransitionError, toStatement, transitionStatement } from "../lib/inventory";
import { cancelStatements, loadOrderRows, orderLabel, sendOrderEmail, toOrderItem, trackingUrl, type OrderEmail, type OrderRow } from "../lib/orders";
import { dailyProductUpsert, dailySalesUpsert, getSettings, openSessionFor } from "../lib/sales";
import { json } from "../lib/validate";
import { requirePermission, allowed } from "../middleware/auth";

const { locations } = tenant;

const changed = () => new AppError(409, "status_changed", "El pedido cambió mientras lo atendías. Recarga para ver su estado.");

async function loadDetail(c: Context<AppEnv>, id: string): Promise<OrderDetail> {
  const { db, tenant: t, role } = c.var.auth;
  const rows = await loadOrderRows(db, t.id, { id });
  if (!rows) throw notFound("Pedido");
  const { order: o, items } = rows;
  const location = await db.select({ name: locations.name }).from(locations).where(eq(locations.id, o.locationId)).get();
  return {
    id: o.id,
    number: o.number,
    token: o.token,
    trackingUrl: trackingUrl(c.env, t.slug, o.token),
    status: o.status,
    fulfillment: o.fulfillment,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    awaitingCardPayment: o.paymentMethod === "card" && o.status === "pending" && o.paymentStatus === "pending",
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    customerPhone: o.customerPhone,
    address: o.address,
    notes: o.notes,
    items: items.map(toOrderItem),
    subtotalCents: o.subtotalCents,
    discountCents: o.discountCents,
    couponCode: o.couponCode,
    taxCents: o.taxCents,
    shippingCents: o.shippingCents,
    totalCents: o.totalCents,
    costCents: allowed(c.var.auth, "costs:read") ? o.costCents : null,
    locationId: o.locationId,
    locationName: location?.name ?? "—",
    paidMethod: o.paidMethod,
    paidReference: o.paidReference,
    paidAt: o.paidAt,
    createdAt: o.createdAt,
    confirmedAt: o.confirmedAt,
    readyAt: o.readyAt,
    completedAt: o.completedAt,
    completedByName: o.completedByName,
    cancelledAt: o.cancelledAt,
    cancelReason: o.cancelReason,
    cancelledBy: o.cancelledBy,
    legal: o.legalAcceptedAt ? { acceptedAt: o.legalAcceptedAt, termsVersion: o.termsVersion, privacyVersion: o.privacyVersion } : null,
  };
}

async function getOrder(c: Context<AppEnv>, id: string) {
  const { db, tenant: t } = c.var.auth;
  const rows = await loadOrderRows(db, t.id, { id });
  if (!rows) throw notFound("Pedido");
  return rows;
}

/** After a status change: email to the customer and webhooks (status changed, and paid when it just got paid). */
function notify(c: Context<AppEnv>, kind: OrderEmail, id: string, opts: { paidNow?: boolean } = {}) {
  const { db, tenant: t } = c.var.auth;
  c.executionCtx.waitUntil(
    (async () => {
      const rows = await loadOrderRows(db, t.id, { id });
      if (!rows) return;
      await Promise.all([
        sendOrderEmail(c.env, db, t.id, t.slug, kind, rows.order, rows.items).catch((e) => console.error("[orders] email", e)),
        (async () => {
          await emitEvent(c.env, t, "order.status_changed", orderData(rows.order, rows.items));
          if (opts.paidNow) await emitEvent(c.env, t, "order.paid", orderData(rows.order, rows.items));
        })().catch((e) => console.error("[orders] webhooks", e)),
      ]);
    })(),
  );
}

/**
 * Records a payment. Cash goes into the open drawer of the order's location as a cash-in,
 * so the cash close still adds up.
 */
async function paymentStatements(c: Context<AppEnv>, order: OrderRow, payment: z.output<typeof orderPaymentSchema>) {
  const { d1, tenant: t, user } = c.var.auth;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let sessionId: string | null = null;
  if (payment.method === "cash") {
    const session = await openSessionFor(c, order.locationId);
    if (!session) throw new AppError(409, "cash_closed", "Para cobrar en efectivo abre la caja de la ubicación del pedido.");
    sessionId = session.id;
    statements.push(
      d1
        .prepare("INSERT INTO cash_movements (id, tenant_id, session_id, type, amount_cents, reason, user_id, user_name, created_at) VALUES (?1, ?2, ?3, 'in', ?4, ?5, ?6, ?7, ?8)")
        .bind(newId(), t.id, session.id, order.totalCents, `Pedido en línea ${orderLabel(order.number)}`, user.id, user.name, now),
    );
  }
  statements.push(
    // Only an unpaid order can be paid: two clerks charging at once fail here.
    d1
      .prepare(
        `UPDATE orders SET payment_status = CASE WHEN payment_status = 'pending' THEN 'paid' END, paid_method = ?1, paid_reference = ?2, paid_at = ?3, session_id = ?4, updated_at = ?3
         WHERE id = ?5 AND tenant_id = ?6`,
      )
      .bind(payment.method, payment.reference, now, sessionId, order.id, t.id),
  );
  return statements;
}
const isPaymentRace = (err: unknown) => /NOT NULL constraint failed: orders\.payment_status/i.test(String((err as Error)?.message ?? err));

const listQuery = z.object({
  status: z.enum(["open", "all", ...ORDER_STATUSES]).default("open"),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const orderRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("orders:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t } = c.var.auth;
    const params: unknown[] = [t.id];
    const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
    const where = ["o.tenant_id = ?1"];
    if (query.status === "open") where.push("o.status IN ('pending', 'confirmed', 'ready')");
    else if (query.status !== "all") where.push(`o.status = ${add(query.status)}`);
    if (query.q?.trim()) {
      const q = query.q.trim().replace(/^#/, "");
      if (/^\d{1,9}$/.test(q)) where.push(`(o.number = ${add(Number(q))} OR instr(o.customer_phone, ${add(q)}) > 0)`);
      else where.push(`instr(lower(o.customer_name || ' ' || o.customer_email), lower(${add(q)})) > 0`);
    }
    const from = `FROM orders o WHERE ${where.join(" AND ")}`;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1
        .prepare(
          `SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS items_count ${from}
           ORDER BY CASE o.status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, o.number DESC
           LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        )
        .bind(...params),
    ]);
    const items: OrderListItem[] = (rows!.results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      number: r.number as number,
      status: r.status as OrderStatus,
      fulfillment: r.fulfillment as OrderListItem["fulfillment"],
      paymentMethod: r.payment_method as OrderListItem["paymentMethod"],
      paymentStatus: r.payment_status as OrderListItem["paymentStatus"],
      customerName: r.customer_name as string,
      customerPhone: r.customer_phone as string,
      itemsCount: r.items_count as number,
      totalCents: r.total_cents as number,
      createdAt: r.created_at as string,
    }));
    const body: Paginated<OrderListItem> = { items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  /** Numbers for the navigation badge. */
  .get("/counts", requirePermission("orders:read"), async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const row = await d1
      .prepare("SELECT SUM(status = 'pending') AS pending, SUM(status IN ('pending', 'confirmed', 'ready')) AS open FROM orders WHERE tenant_id = ?1")
      .bind(t.id)
      .first<{ pending: number | null; open: number | null }>();
    return c.json({ pending: row?.pending ?? 0, open: row?.open ?? 0 });
  })

  .get("/:id", requirePermission("orders:read"), async (c) => c.json(await loadDetail(c, c.req.param("id"))))

  /** New → accepted (preparing). */
  .post("/:id/confirm", requirePermission("orders:fulfill"), async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const { order } = await getOrder(c, c.req.param("id"));
    if (order.status !== "pending") throw changed();
    const now = new Date().toISOString();
    try {
      await d1.batch([
        transitionStatement(d1, "orders", { id: order.id, tenantId: t.id }, ["pending"], "confirmed", { confirmed_at: now, updated_at: now }),
        toStatement(d1, auditEntry(c, { action: "order.confirm", entity: "order", entityId: order.id, after: { number: order.number } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    notify(c, "confirmed", order.id);
    return c.json(await loadDetail(c, order.id));
  })

  /** Accepted → ready for pickup / out for delivery. */
  .post("/:id/ready", requirePermission("orders:fulfill"), async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const { order } = await getOrder(c, c.req.param("id"));
    if (order.status !== "pending" && order.status !== "confirmed") throw changed();
    const now = new Date().toISOString();
    try {
      await d1.batch([
        transitionStatement(d1, "orders", { id: order.id, tenantId: t.id }, ["pending", "confirmed"], "ready", { ready_at: now, confirmed_at: order.confirmedAt ?? now, updated_at: now }),
        toStatement(d1, auditEntry(c, { action: "order.ready", entity: "order", entityId: order.id, after: { number: order.number } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    notify(c, "ready", order.id);
    return c.json(await loadDetail(c, order.id));
  })

  /** Record the payment (e.g. a transfer arrived) before delivering. */
  .post("/:id/pay", requirePermission("orders:fulfill"), json(orderPaymentSchema), async (c) => {
    const payment = c.req.valid("json");
    const { d1 } = c.var.auth;
    const { order } = await getOrder(c, c.req.param("id"));
    if (order.status === "cancelled" || order.status === "completed") throw changed();
    if (order.paymentStatus === "paid") throw new AppError(409, "already_paid", "Este pedido ya está pagado.");
    const statements = await paymentStatements(c, order, payment);
    statements.push(toStatement(d1, auditEntry(c, { action: "order.pay", entity: "order", entityId: order.id, after: { method: payment.method, reference: payment.reference, totalCents: order.totalCents } })));
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isPaymentRace(err)) throw new AppError(409, "already_paid", "Este pedido ya está pagado.");
      throw err;
    }
    const detail = await loadDetail(c, order.id);
    const rows = await loadOrderRows(c.var.auth.db, c.var.auth.tenant.id, { id: order.id });
    if (rows) emitFrom(c, "order.paid", orderData(rows.order, rows.items));
    return c.json(detail);
  })

  /**
   * Delivered and paid. Counts as a sale in the daily summaries (by business date), in the same
   * batch as the status change and, if still unpaid, the payment.
   */
  .post("/:id/complete", requirePermission("orders:fulfill"), json(completeOrderSchema), async (c) => {
    const { payment } = c.req.valid("json");
    const { d1, tenant: t, user } = c.var.auth;
    const { order, items } = await getOrder(c, c.req.param("id"));
    if (order.status === "completed" || order.status === "cancelled") throw changed();
    if (order.paymentStatus === "pending" && !payment) throw new AppError(422, "payment_required", "Registra cómo pagó el cliente para entregar el pedido.", { method: "Elige cómo pagó" });
    const settings = await getSettings(c);
    const date = businessDate(settings.timezone);
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    if (order.paymentStatus === "pending" && payment) statements.push(...(await paymentStatements(c, order, payment)));
    statements.push(
      transitionStatement(d1, "orders", { id: order.id, tenantId: t.id }, ["pending", "confirmed", "ready"], "completed", {
        completed_at: now, completed_by_name: user.name, business_date: date, updated_at: now,
        confirmed_at: order.confirmedAt ?? now, ready_at: order.readyAt ?? now,
      }),
      dailySalesUpsert(d1, {
        tenantId: t.id, date, locationId: order.locationId, count: 1, total: order.totalCents, discount: 0, tax: order.taxCents, cost: order.costCents,
        returns: 0, voided: 0, onlineCount: 1, onlineTotal: order.totalCents,
      }),
    );
    const perVariant = new Map<string, { productId: string; quantity: number; total: number; cost: number }>();
    for (const i of items) {
      const agg = perVariant.get(i.variantId) ?? { productId: i.productId, quantity: 0, total: 0, cost: 0 };
      agg.quantity += i.quantity;
      agg.total += i.totalCents;
      agg.cost += Math.round((i.unitCostCents * i.quantity) / 1000);
      perVariant.set(i.variantId, agg);
    }
    for (const [variantId, agg] of perVariant) statements.push(dailyProductUpsert(d1, { tenantId: t.id, date, variantId, ...agg }));
    statements.push(toStatement(d1, auditEntry(c, { action: "order.complete", entity: "order", entityId: order.id, after: { number: order.number, totalCents: order.totalCents, payment: payment?.method ?? order.paidMethod } })));
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      if (isPaymentRace(err)) throw new AppError(409, "already_paid", "Otra persona registró el pago al mismo tiempo. Recarga e intenta de nuevo.");
      throw err;
    }
    notify(c, "completed", order.id, { paidNow: order.paymentStatus === "pending" });
    return c.json(await loadDetail(c, order.id));
  })

  /** Cancel and release the stock. If it was paid, the refund is handled by the business. */
  .post("/:id/cancel", requirePermission("orders:cancel"), json(reasonSchema), async (c) => {
    const { reason } = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    const { order, items } = await getOrder(c, c.req.param("id"));
    if (order.status === "completed" || order.status === "cancelled") throw changed();
    try {
      await d1.batch(cancelStatements(d1, db, { tenantId: t.id, userId: user.id, userName: user.name }, order, items, { reason, by: "staff", from: ["pending", "confirmed", "ready"], ip: c.req.header("cf-connecting-ip") ?? null }));
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    notify(c, "cancelled", order.id);
    const settings = await getSettings(c);
    const detail = await loadDetail(c, order.id);
    return c.json({ ...detail, refundCents: order.paymentStatus === "paid" ? order.totalCents : 0, refundLabel: order.paymentStatus === "paid" ? formatMoney(order.totalCents, settings.currency, settings.locale) : null });
  });
