/**
 * Online orders: shared by the public store API, the dashboard and the hourly expiry job.
 */
import { and, asc, eq } from "drizzle-orm";
import { control, controlDb, tenant, tenantDb, type TenantDb } from "@nexo/db";
import {
  customerStatusLabel,
  FULFILLMENT_LABELS,
  formatMoney,
  formatQty,
  fromMilli,
  ONLINE_PAYMENT_LABELS,
  type OrderItem,
  type PublicOrder,
  type UnitCode,
} from "@nexo/shared";
import type { Env } from "../env";
import { newId } from "./crypto";
import { sendEmail } from "./email";
import { movementStatements, toStatement, transitionStatement, type MovementActor } from "./inventory";
import { getTenantD1 } from "./tenant";

const { orders, orderItems, storeSettings, businessSettings, locations, auditLog } = tenant;

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;

export const orderLabel = (n: number) => `#${String(n).padStart(6, "0")}`;
export const trackingUrl = (env: Env, slug: string, token: string) => `${env.STORE_URL.replace(/\/$/, "")}/${slug}/pedido/${token}`;

export const toOrderItem = (i: OrderItemRow): OrderItem => ({
  id: i.id,
  variantId: i.variantId,
  productId: i.productId,
  name: i.name,
  options: i.options,
  sku: i.sku,
  unit: i.unit as UnitCode,
  image: i.image,
  quantity: fromMilli(i.quantity),
  unitPriceCents: i.unitPriceCents,
  taxRateBps: i.taxRateBps,
  totalCents: i.totalCents,
});

export async function loadOrderRows(db: TenantDb, tenantId: string, where: { id?: string; token?: string }) {
  const cond = where.id ? eq(orders.id, where.id) : eq(orders.token, where.token!);
  const order = await db.select().from(orders).where(and(cond, eq(orders.tenantId, tenantId))).get();
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.position));
  return { order, items };
}

export async function toPublicOrder(db: TenantDb, tenantId: string, order: OrderRow, items: OrderItemRow[]): Promise<PublicOrder> {
  const [store, location] = await Promise.all([
    db.select().from(storeSettings).where(eq(storeSettings.tenantId, tenantId)).get(),
    db.select({ name: locations.name, address: locations.address }).from(locations).where(eq(locations.id, order.locationId)).get(),
  ]);
  return {
    number: order.number,
    status: order.status,
    fulfillment: order.fulfillment,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    address: order.address,
    notes: order.notes,
    items: items.map(toOrderItem),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    couponCode: order.couponCode,
    taxCents: order.taxCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    readyAt: order.readyAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    canCancel: order.status === "pending" && order.paymentStatus === "pending",
    transferInstructions: order.paymentMethod === "transfer" ? (store?.transferInstructions ?? null) : null,
    pickupInstructions: order.fulfillment === "pickup" ? (store?.pickupInstructions ?? null) : null,
    pickupAddress: order.fulfillment === "pickup" ? (location?.address ?? location?.name ?? null) : null,
  };
}

/**
 * Cancels an order: status (guarded), stock back to the location for tracked lines, audit.
 * `from` are the statuses it may be cancelled from.
 */
export function cancelStatements(
  d1: D1Database,
  db: TenantDb,
  actor: MovementActor,
  order: OrderRow,
  items: OrderItemRow[],
  opts: { reason: string; by: "customer" | "staff" | "system"; from: readonly string[]; ip?: string | null },
): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    transitionStatement(d1, "orders", { id: order.id, tenantId: actor.tenantId }, opts.from, "cancelled", {
      cancelled_at: now, cancel_reason: opts.reason, cancelled_by: opts.by, updated_at: now,
    }),
  ];
  for (const i of items) {
    if (!i.trackInventory) continue;
    statements.push(
      ...movementStatements(d1, actor, {
        kind: "in", type: "order_cancel", variantId: i.variantId, locationId: order.locationId, quantityMilli: i.quantity, unitCostCents: null,
        reason: opts.by === "system" ? "order_expired" : "order_cancel", reference: order.id, note: `Pedido ${orderLabel(order.number)}`,
      }),
    );
  }
  statements.push(
    toStatement(
      d1,
      db.insert(auditLog).values({
        id: newId(), tenantId: actor.tenantId, userId: actor.userId, userName: actor.userName ?? (opts.by === "customer" ? order.customerName : "Sistema"),
        action: "order.cancel", entity: "order", entityId: order.id, after: { number: order.number, by: opts.by, reason: opts.reason }, ip: opts.ip ?? null,
      }),
    ),
  );
  return statements;
}

/* ---------- Emails ---------- */

export type OrderEmail = "placed" | "confirmed" | "ready" | "completed" | "cancelled" | "new_order";

export async function sendOrderEmail(env: Env, db: TenantDb, tenantId: string, slug: string, kind: OrderEmail, order: OrderRow, items: OrderItemRow[]) {
  const [biz, store] = await Promise.all([
    db.select().from(businessSettings).where(eq(businessSettings.tenantId, tenantId)).get(),
    db.select().from(storeSettings).where(eq(storeSettings.tenantId, tenantId)).get(),
  ]);
  if (!biz) return;
  const money = (v: number) => formatMoney(v, biz.currency, biz.locale);
  const label = orderLabel(order.number);
  const link = trackingUrl(env, slug, order.token);
  const lines = items.map((i) => `- ${formatQty(fromMilli(i.quantity), i.unit)} × ${i.options.length ? `${i.name} (${i.options.join(" / ")})` : i.name} — ${money(i.totalCents)}`);
  const summary = [
    ...lines,
    "",
    order.shippingCents ? `Envío: ${money(order.shippingCents)}` : null,
    `Total: ${money(order.totalCents)}`,
    `${FULFILLMENT_LABELS[order.fulfillment]} · ${ONLINE_PAYMENT_LABELS[order.paymentMethod]}`,
    order.address ? `Entrega en: ${order.address}` : null,
  ].filter((l): l is string => l !== null);

  if (kind === "new_order") {
    const to = store?.notifyEmail ?? biz.email;
    if (!to) return;
    await sendEmail(env, {
      to,
      subject: `Nuevo pedido ${label} — ${money(order.totalCents)}`,
      text: [`${order.customerName} hizo un pedido en tu tienda en línea.`, `Tel. ${order.customerPhone} · ${order.customerEmail}`, order.notes ? `Notas: ${order.notes}` : "", "", ...summary, "", `Atiéndelo en tu panel: ${env.APP_URL.replace(/\/$/, "")}/pedidos/${order.id}`].join("\n"),
    });
    return;
  }

  const intro: Record<Exclude<OrderEmail, "new_order">, string> = {
    placed: `¡Gracias, ${order.customerName.split(" ")[0]}! Recibimos tu pedido ${label}.`,
    confirmed: `Tu pedido ${label} fue aceptado y lo estamos preparando.`,
    ready: order.fulfillment === "pickup" ? `Tu pedido ${label} está listo para recoger.` : `Tu pedido ${label} va en camino.`,
    completed: `Tu pedido ${label} fue entregado. ¡Gracias por tu compra!`,
    cancelled: `Tu pedido ${label} fue cancelado${order.cancelReason ? `: ${order.cancelReason}` : "."}`,
  };
  const extra: string[] = [];
  if (kind === "placed" && order.paymentMethod === "transfer" && store?.transferInstructions) extra.push("Para pagar por transferencia:", store.transferInstructions, "");
  if ((kind === "placed" || kind === "ready") && order.fulfillment === "pickup" && store?.pickupInstructions) extra.push(store.pickupInstructions, "");
  if (kind === "cancelled" && order.paymentStatus === "paid") extra.push("Como ya habías pagado, nos pondremos en contacto contigo para el reembolso.", "");
  await sendEmail(env, {
    to: order.customerEmail,
    subject: `${biz.tradeName}: pedido ${label} — ${customerStatusLabel(order.status, order.fulfillment)}`,
    text: [intro[kind], "", ...extra, ...summary, "", `Sigue tu pedido: ${link}`, "", [biz.tradeName, biz.phone, store?.whatsapp ? `WhatsApp ${store.whatsapp}` : null].filter(Boolean).join(" · ")].join("\n"),
  });
}

/* ---------- Hourly job: release stock of orders nobody confirmed ---------- */

export async function expireOrders(env: Env): Promise<number> {
  const tenants = await tenantDbsWithStores(env);
  let expired = 0;
  for (const t of tenants) {
    const d1 = getTenantD1(env, t);
    const db = tenantDb(d1);
    const { results } = await d1
      .prepare(
        `SELECT o.id FROM orders o JOIN store_settings s ON s.tenant_id = o.tenant_id
         WHERE o.tenant_id = ?1 AND o.status = 'pending' AND o.payment_status = 'pending' AND s.hold_hours > 0
           AND o.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || s.hold_hours || ' hours')
         LIMIT 100`,
      )
      .bind(t.id)
      .all<{ id: string }>();
    for (const { id } of results) {
      const rows = await loadOrderRows(db, t.id, { id });
      if (!rows) continue;
      try {
        await d1.batch(cancelStatements(d1, db, { tenantId: t.id, userId: null, userName: "Sistema" }, rows.order, rows.items, { reason: "No se confirmó a tiempo", by: "system", from: ["pending"] }));
        expired++;
        const after = await loadOrderRows(db, t.id, { id });
        if (after) await sendOrderEmail(env, db, t.id, t.slug, "cancelled", after.order, after.items).catch(() => {});
      } catch (err) {
        console.error("[orders] expire failed", id, err);
      }
    }
  }
  return expired;
}

async function tenantDbsWithStores(env: Env) {
  const rows = await controlDb(env.DB_CONTROL)
    .select({ id: control.tenants.id, slug: control.tenants.slug, dbBinding: control.tenants.dbBinding })
    .from(control.tenants)
    .where(eq(control.tenants.status, "active"));
  return rows;
}
