import { Hono, type Context } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import {
  computePurchase,
  docNumber,
  dueDate,
  emailSupplierSchema,
  formatMoney,
  formatQty,
  fromMilli,
  purchaseOrderSchema,
  PURCHASE_STATUSES,
  quantityFitsUnit,
  reasonSchema,
  receivePurchaseSchema,
  suggestedReorderMilli,
  toMilli,
  unitInfo,
  type Paginated,
  type PurchaseOrderDetail,
  type PurchaseOrderInput,
  type PurchaseOrderListItem,
  type PurchaseStatus,
  type PurchaseSuggestion,
  type UnitCode,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { sendEmail } from "../lib/email";
import { AppError, notFound } from "../lib/errors";
import { chunk, isCheckError, isTransitionError, movementStatements, toStatement, transitionStatement } from "../lib/inventory";
import { resolveLines } from "../lib/lines";
import { lookupVariants } from "../lib/lookup";
import { getSettings } from "../lib/sales";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { purchaseOrders, purchaseOrderItems, purchaseReceipts, purchaseReceiptItems, suppliers, locations, variants, stockLevels } = tenant;

const changed = () => new AppError(409, "status_changed", "La orden cambió mientras la editabas. Recarga para ver su estado actual.");

/* ---------- Loading ---------- */

export async function loadOrder(c: Context<AppEnv>, id: string): Promise<PurchaseOrderDetail | null> {
  const { db, tenant: t } = c.var.auth;
  const o = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, t.id))).get();
  if (!o) return null;
  const [supplier, location, items, receipts] = await Promise.all([
    db.select().from(suppliers).where(eq(suppliers.id, o.supplierId)).get(),
    db.select({ name: locations.name }).from(locations).where(eq(locations.id, o.locationId)).get(),
    db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id)).orderBy(asc(purchaseOrderItems.position)),
    db.select().from(purchaseReceipts).where(eq(purchaseReceipts.orderId, id)).orderBy(asc(purchaseReceipts.createdAt)),
  ]);
  const variantIds = [...new Set(items.map((i) => i.variantId))];
  const stock = new Map<string, number>();
  const cost = new Map<string, number>();
  for (const part of chunk(variantIds)) {
    const [levels, vs] = await Promise.all([
      db.select({ v: stockLevels.variantId, q: stockLevels.quantity }).from(stockLevels).where(and(eq(stockLevels.tenantId, t.id), eq(stockLevels.locationId, o.locationId), inArray(stockLevels.variantId, part))),
      db.select({ id: variants.id, cost: variants.costCents }).from(variants).where(and(eq(variants.tenantId, t.id), inArray(variants.id, part))),
    ]);
    levels.forEach((l) => stock.set(l.v, l.q));
    vs.forEach((v) => cost.set(v.id, v.cost));
  }
  const receiptItems = receipts.length
    ? await db.select().from(purchaseReceiptItems).where(inArray(purchaseReceiptItems.receiptId, receipts.map((r) => r.id)))
    : [];
  const totals = computePurchase(items.map((i) => ({ quantityMilli: i.quantity, unitCostCents: i.unitCostCents, taxRateBps: i.taxRateBps })));
  const ordered = items.reduce((a, i) => a + i.quantity, 0);
  const received = items.reduce((a, i) => a + i.receivedQuantity, 0);
  const byItem = new Map(items.map((i) => [i.id, i]));
  const s = supplier!;
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    supplierId: o.supplierId,
    supplier: {
      id: s.id, name: s.name, contactName: s.contactName, email: s.email, phone: s.phone, taxId: s.taxId, address: s.address,
      paymentTermsDays: s.paymentTermsDays, notes: s.notes, active: s.active, createdAt: s.createdAt,
    },
    locationId: o.locationId,
    locationName: location?.name ?? "—",
    expectedDate: o.expectedDate,
    note: o.note,
    subtotalCents: o.subtotalCents,
    taxCents: o.taxCents,
    totalCents: o.totalCents,
    receivedCents: o.receivedCents,
    createdAt: o.createdAt,
    createdByName: o.createdByName,
    orderedAt: o.orderedAt,
    closedAt: o.closedAt,
    cancelledAt: o.cancelledAt,
    cancelReason: o.cancelReason,
    progress: ordered ? received / ordered : 0,
    items: items.map((i, n) => ({
      id: i.id,
      variantId: i.variantId,
      productId: i.productId,
      name: i.name,
      options: i.options,
      sku: i.sku,
      unit: i.unit as UnitCode,
      quantity: fromMilli(i.quantity),
      receivedQuantity: fromMilli(i.receivedQuantity),
      unitCostCents: i.unitCostCents,
      taxRateBps: i.taxRateBps,
      ...totals.lines[n]!,
      stock: fromMilli(stock.get(i.variantId) ?? 0),
      currentCostCents: cost.get(i.variantId) ?? 0,
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      userName: r.userName,
      supplierReference: r.supplierReference,
      note: r.note,
      totalCents: r.totalCents,
      dueDate: dueDate(r.createdAt.slice(0, 10), s.paymentTermsDays),
      items: receiptItems
        .filter((x) => x.receiptId === r.id)
        .map((x) => {
          const item = byItem.get(x.orderItemId)!;
          return { orderItemId: x.orderItemId, name: item.name, options: item.options, unit: item.unit as UnitCode, quantity: fromMilli(x.quantity), unitCostCents: x.unitCostCents };
        }),
    })),
  };
}

/** Validates the lines of an order against the catalog and returns the rows to insert. */
async function buildLines(c: Context<AppEnv>, orderId: string, items: z.output<typeof purchaseOrderSchema>["items"]) {
  const resolved = await resolveLines(c, items, "la orden");
  return resolved.map((l, i) => ({
    id: newId(), tenantId: c.var.auth.tenant.id, orderId, variantId: l.variantId, productId: l.productId, name: l.name, options: l.options, sku: l.sku, unit: l.unit,
    quantity: l.quantityMilli, unitCostCents: items[i]!.unitCostCents, taxRateBps: items[i]!.taxRateBps, position: i,
  }));
}

async function checkHeader(c: Context<AppEnv>, input: { supplierId: string; locationId: string }) {
  const { db, tenant: t } = c.var.auth;
  const [s, l] = await Promise.all([
    db.select({ active: suppliers.active }).from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, t.id))).get(),
    db.select({ active: locations.active }).from(locations).where(and(eq(locations.id, input.locationId), eq(locations.tenantId, t.id))).get(),
  ]);
  if (!s) throw new AppError(422, "validation_error", "Revisa los campos marcados", { supplierId: "Elige un proveedor" });
  if (!s.active) throw new AppError(422, "validation_error", "Revisa los campos marcados", { supplierId: "Este proveedor está desactivado" });
  if (!l || !l.active) throw new AppError(422, "validation_error", "Revisa los campos marcados", { locationId: "Elige una ubicación activa" });
}

async function getOrder(c: Context<AppEnv>, id: string) {
  const { db, tenant: t } = c.var.auth;
  const o = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, t.id))).get();
  if (!o) throw notFound("Orden de compra");
  return o;
}

/** Creates an order in draft with the next folio, all in one batch. */
async function createOrder(c: Context<AppEnv>, input: z.output<typeof purchaseOrderSchema>, action = "purchase.create") {
  const { db, d1, tenant: t, user } = c.var.auth;
  await checkHeader(c, input);
  const id = newId();
  const lines = await buildLines(c, id, input.items);
  const totals = computePurchase(lines.map((l) => ({ quantityMilli: l.quantity, unitCostCents: l.unitCostCents, taxRateBps: l.taxRateBps })));
  const now = new Date().toISOString();
  await d1.batch([
    d1.prepare("INSERT INTO counters (tenant_id, name, value) VALUES (?1, 'purchase', 1) ON CONFLICT(tenant_id, name) DO UPDATE SET value = value + 1").bind(t.id),
    d1
      .prepare(
        `INSERT INTO purchase_orders (id, tenant_id, number, supplier_id, location_id, status, expected_date, note, subtotal_cents, tax_cents, total_cents,
           created_by, created_by_name, created_at, updated_at)
         SELECT ?1, ?2, value, ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12 FROM counters WHERE tenant_id = ?2 AND name = 'purchase'`,
      )
      .bind(id, t.id, input.supplierId, input.locationId, input.expectedDate, input.note, totals.subtotalCents, totals.taxCents, totals.totalCents, user.id, user.name, now),
    ...lines.map((l) => toStatement(d1, db.insert(purchaseOrderItems).values(l))),
    toStatement(d1, auditEntry(c, { action, entity: "purchase_order", entityId: id, after: { supplierId: input.supplierId, lines: lines.length, totalCents: totals.totalCents } })),
  ]);
  return id;
}

const listQuery = z.object({
  status: z.enum(["all", "open", ...PURCHASE_STATUSES]).default("all"),
  supplierId: z.string().max(40).optional(),
  locationId: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const purchaseRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("purchases:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t } = c.var.auth;
    const params: unknown[] = [t.id];
    const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
    const where = ["o.tenant_id = ?1"];
    if (query.status === "open") where.push("o.status IN ('draft', 'ordered', 'partial')");
    else if (query.status !== "all") where.push(`o.status = ${add(query.status)}`);
    if (query.supplierId) where.push(`o.supplier_id = ${add(query.supplierId)}`);
    if (query.locationId) where.push(`o.location_id = ${add(query.locationId)}`);
    if (query.q?.trim()) {
      const q = query.q.trim().replace(/^(oc-?|#)/i, "");
      if (/^\d+$/.test(q)) where.push(`o.number = ${add(Number(q))}`);
      else where.push(`instr(lower(s.name), lower(${add(q)})) > 0`);
    }
    const from = `FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN locations l ON l.id = o.location_id WHERE ${where.join(" AND ")}`;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1
        .prepare(
          `SELECT o.*, s.name AS supplier_name, l.name AS location_name,
             (SELECT COUNT(*) FROM purchase_order_items i WHERE i.order_id = o.id) AS items_count,
             (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_items i WHERE i.order_id = o.id) AS qty,
             (SELECT COALESCE(SUM(received_quantity), 0) FROM purchase_order_items i WHERE i.order_id = o.id) AS rec
           ${from} ORDER BY o.number DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        )
        .bind(...params),
    ]);
    const items: PurchaseOrderListItem[] = (rows!.results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      number: r.number as number,
      status: r.status as PurchaseStatus,
      supplierId: r.supplier_id as string,
      supplierName: r.supplier_name as string,
      locationName: (r.location_name as string | null) ?? "—",
      expectedDate: r.expected_date as string | null,
      totalCents: r.total_cents as number,
      receivedCents: r.received_cents as number,
      itemsCount: r.items_count as number,
      progress: (r.qty as number) ? (r.rec as number) / (r.qty as number) : 0,
      createdAt: r.created_at as string,
      orderedAt: r.ordered_at as string | null,
    }));
    const body: Paginated<PurchaseOrderListItem> = { items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  /** Products at or under their minimum at a location, with a suggested quantity. */
  .get("/suggestions", requirePermission("purchases:write"), async (c) => {
    const { locationId } = z.object({ locationId: z.string().min(1).max(40) }).parse(c.req.query());
    const { d1, tenant: t } = c.var.auth;
    const rows = await lookupVariants(d1, t.id, { locationId, lowOnly: true, limit: 200, showCost: true });
    const items: PurchaseSuggestion[] = rows
      .map((r) => ({ ...r, suggestedQuantity: fromMilli(suggestedReorderMilli(toMilli(r.stock), toMilli(r.minStock), unitInfo(r.unit).decimals)) }))
      .filter((r) => r.suggestedQuantity > 0);
    return c.json(items);
  })

  .get("/:id", requirePermission("purchases:read"), async (c) => {
    const order = await loadOrder(c, c.req.param("id"));
    if (!order) throw notFound("Orden de compra");
    return c.json(order);
  })

  .post("/", requirePermission("purchases:write"), json(purchaseOrderSchema), async (c) => {
    const id = await createOrder(c, c.req.valid("json"));
    return c.json(await loadOrder(c, id), 201);
  })

  /** Edit while nothing has been received (draft or ordered). Replaces every line. */
  .put("/:id", requirePermission("purchases:write"), json(purchaseOrderSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const o = await getOrder(c, c.req.param("id"));
    if (o.status !== "draft" && o.status !== "ordered") throw new AppError(409, "not_editable", "Solo se pueden editar órdenes sin recepciones.");
    await checkHeader(c, input);
    const lines = await buildLines(c, o.id, input.items);
    const totals = computePurchase(lines.map((l) => ({ quantityMilli: l.quantity, unitCostCents: l.unitCostCents, taxRateBps: l.taxRateBps })));
    try {
      await d1.batch([
        transitionStatement(d1, "purchase_orders", { id: o.id, tenantId: t.id }, [o.status], o.status, {
          supplier_id: input.supplierId, location_id: input.locationId, expected_date: input.expectedDate, note: input.note,
          subtotal_cents: totals.subtotalCents, tax_cents: totals.taxCents, total_cents: totals.totalCents, updated_at: new Date().toISOString(),
        }),
        toStatement(d1, db.delete(purchaseOrderItems).where(and(eq(purchaseOrderItems.orderId, o.id), eq(purchaseOrderItems.tenantId, t.id)))),
        ...lines.map((l) => toStatement(d1, db.insert(purchaseOrderItems).values(l))),
        toStatement(d1, auditEntry(c, { action: "purchase.update", entity: "purchase_order", entityId: o.id, before: { totalCents: o.totalCents }, after: { lines: lines.length, totalCents: totals.totalCents } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadOrder(c, o.id));
  })

  /** Draft → ordered: the order was sent to the supplier. */
  .post("/:id/order", requirePermission("purchases:write"), async (c) => {
    const { d1, tenant: t } = c.var.auth;
    const o = await getOrder(c, c.req.param("id"));
    if (o.status !== "draft") throw new AppError(409, "not_draft", "Esta orden ya fue pedida.");
    const now = new Date().toISOString();
    try {
      await d1.batch([
        transitionStatement(d1, "purchase_orders", { id: o.id, tenantId: t.id }, ["draft"], "ordered", { ordered_at: now, updated_at: now }),
        toStatement(d1, auditEntry(c, { action: "purchase.order", entity: "purchase_order", entityId: o.id, after: { number: o.number } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadOrder(c, o.id));
  })

  /**
   * Receive goods (all or part). One batch: receipt, received quantities, stock entries at the
   * received cost (weighted average), order status and audit. Concurrent receipts can never
   * exceed the ordered quantity: CHECK (received_quantity <= quantity) fails the batch.
   */
  .post("/:id/receive", requirePermission("purchases:receive"), json(receivePurchaseSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    const o = await getOrder(c, c.req.param("id"));
    if (o.status === "draft") throw new AppError(409, "not_ordered", "Marca la orden como pedida antes de recibirla.");
    if (o.status !== "ordered" && o.status !== "partial") throw new AppError(409, "closed", "Esta orden ya está cerrada.");
    const location = await db.select({ active: locations.active }).from(locations).where(eq(locations.id, o.locationId)).get();
    if (!location?.active) throw new AppError(409, "inactive_location", "La ubicación de esta orden está desactivada. Actívala para recibir.");
    const items = await db.select().from(purchaseOrderItems).where(and(eq(purchaseOrderItems.orderId, o.id), eq(purchaseOrderItems.tenantId, t.id)));
    const byId = new Map(items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const lines = input.items
      .map((line, i) => {
        const item = byId.get(line.orderItemId);
        if (!item || seen.has(line.orderItemId)) throw new AppError(422, "validation_error", "Una línea no pertenece a esta orden.", { [`items.${i}`]: "No válida" });
        seen.add(line.orderItemId);
        if (!quantityFitsUnit(line.quantity, item.unit)) {
          throw new AppError(422, "validation_error", `${item.name}: ${unitInfo(item.unit).decimals ? "máximo 3 decimales" : "usa cantidades enteras"}`, { [`items.${i}.quantity`]: "Cantidad no válida" });
        }
        const q = toMilli(line.quantity);
        const pending = item.quantity - item.receivedQuantity;
        if (q > pending) {
          throw new AppError(422, "validation_error", `${item.name}: solo faltan ${formatQty(fromMilli(pending), item.unit)} por recibir.`, { [`items.${i}.quantity`]: `Máximo ${formatQty(fromMilli(pending), item.unit)}` });
        }
        return { item, q, cost: line.unitCostCents };
      })
      .filter((l) => l.q > 0);
    if (!lines.length) throw new AppError(422, "validation_error", "Indica la cantidad recibida de al menos un producto.");

    const receiptId = newId();
    const now = new Date().toISOString();
    const total = lines.reduce((a, l) => a + Math.round((l.cost * l.q) / 1000), 0);
    const actor = { tenantId: t.id, userId: user.id, userName: user.name };
    const label = docNumber("purchase", o.number);
    const statements: D1PreparedStatement[] = [
      transitionStatement(d1, "purchase_orders", { id: o.id, tenantId: t.id }, ["ordered", "partial"], "partial", { updated_at: now }),
      d1.prepare("UPDATE purchase_orders SET received_cents = received_cents + ?1 WHERE id = ?2 AND tenant_id = ?3").bind(total, o.id, t.id),
      toStatement(d1, db.insert(purchaseReceipts).values({ id: receiptId, tenantId: t.id, orderId: o.id, locationId: o.locationId, supplierReference: input.supplierReference, note: input.note, totalCents: total, userId: user.id, userName: user.name, createdAt: now })),
    ];
    for (const l of lines) {
      statements.push(
        toStatement(d1, db.insert(purchaseReceiptItems).values({ id: newId(), tenantId: t.id, receiptId, orderItemId: l.item.id, variantId: l.item.variantId, quantity: l.q, unitCostCents: l.cost })),
        d1.prepare("UPDATE purchase_order_items SET received_quantity = received_quantity + ?1 WHERE id = ?2 AND tenant_id = ?3").bind(l.q, l.item.id, t.id),
        ...movementStatements(d1, actor, {
          kind: "in", type: "purchase", variantId: l.item.variantId, locationId: o.locationId, quantityMilli: l.q, unitCostCents: l.cost,
          reason: "purchase_receipt", reference: o.id, note: input.supplierReference ? `${label} · Factura ${input.supplierReference}` : label,
        }),
      );
    }
    // Final status once every line is updated: received when nothing is pending.
    statements.push(
      d1
        .prepare(
          `UPDATE purchase_orders SET
             status = CASE WHEN (SELECT COALESCE(SUM(quantity - received_quantity), 0) FROM purchase_order_items WHERE order_id = ?1) = 0 THEN 'received' ELSE 'partial' END,
             closed_at = CASE WHEN (SELECT COALESCE(SUM(quantity - received_quantity), 0) FROM purchase_order_items WHERE order_id = ?1) = 0 THEN ?2 ELSE NULL END
           WHERE id = ?1 AND tenant_id = ?3`,
        )
        .bind(o.id, now, t.id),
      toStatement(d1, auditEntry(c, { action: "purchase.receive", entity: "purchase_order", entityId: o.id, after: { receiptId, lines: lines.length, totalCents: total, supplierReference: input.supplierReference } })),
    );
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      if (isCheckError(err, "purchase_order_items_received_le_qty")) throw new AppError(409, "over_received", "Otra recepción de esta orden se registró al mismo tiempo. Recarga para ver lo que falta.");
      throw err;
    }
    return c.json(await loadOrder(c, o.id), 201);
  })

  /** Partial → received: the supplier will not deliver the rest. */
  .post("/:id/close", requirePermission("purchases:write"), json(reasonSchema), async (c) => {
    const { reason } = c.req.valid("json");
    const { d1, tenant: t } = c.var.auth;
    const o = await getOrder(c, c.req.param("id"));
    if (o.status !== "partial") throw new AppError(409, "not_partial", "Solo se cierran órdenes recibidas en parte.");
    const now = new Date().toISOString();
    try {
      await d1.batch([
        transitionStatement(d1, "purchase_orders", { id: o.id, tenantId: t.id }, ["partial"], "received", { closed_at: now, updated_at: now, cancel_reason: reason }),
        toStatement(d1, auditEntry(c, { action: "purchase.close", entity: "purchase_order", entityId: o.id, after: { reason } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadOrder(c, o.id));
  })

  /** Draft or ordered (nothing received) → cancelled. Orders are never deleted, so folios stay gapless. */
  .post("/:id/cancel", requirePermission("purchases:write"), json(reasonSchema), async (c) => {
    const { reason } = c.req.valid("json");
    const { d1, tenant: t } = c.var.auth;
    const o = await getOrder(c, c.req.param("id"));
    if (o.status === "partial") throw new AppError(409, "has_receipts", "Esta orden ya tiene recepciones. Ciérrala con lo recibido.");
    if (o.status !== "draft" && o.status !== "ordered") throw new AppError(409, "closed", "Esta orden ya está cerrada.");
    const now = new Date().toISOString();
    try {
      await d1.batch([
        transitionStatement(d1, "purchase_orders", { id: o.id, tenantId: t.id }, ["draft", "ordered"], "cancelled", { cancelled_at: now, updated_at: now, cancel_reason: reason }),
        toStatement(d1, auditEntry(c, { action: "purchase.cancel", entity: "purchase_order", entityId: o.id, after: { reason } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadOrder(c, o.id));
  })

  /** New draft with the same supplier, location and quantities, at today's average costs. */
  .post("/:id/duplicate", requirePermission("purchases:write"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const o = await getOrder(c, c.req.param("id"));
    const items = await db
      .select({ variantId: purchaseOrderItems.variantId, quantity: purchaseOrderItems.quantity, taxRateBps: purchaseOrderItems.taxRateBps, cost: variants.costCents, orderCost: purchaseOrderItems.unitCostCents, deleted: variants.deletedAt })
      .from(purchaseOrderItems)
      .innerJoin(variants, eq(variants.id, purchaseOrderItems.variantId))
      .where(and(eq(purchaseOrderItems.orderId, o.id), eq(purchaseOrderItems.tenantId, t.id)))
      .orderBy(asc(purchaseOrderItems.position));
    const alive = items.filter((i) => !i.deleted);
    if (!alive.length) throw new AppError(409, "empty", "Los productos de esta orden ya no existen.");
    const input: PurchaseOrderInput = {
      supplierId: o.supplierId,
      locationId: o.locationId,
      items: alive.map((i) => ({ variantId: i.variantId, quantity: fromMilli(i.quantity), unitCostCents: i.cost || i.orderCost, taxRateBps: i.taxRateBps })),
    };
    const id = await createOrder(c, purchaseOrderSchema.parse(input), "purchase.duplicate");
    return c.json(await loadOrder(c, id), 201);
  })

  /** Sends the order to the supplier by email (plain text). */
  .post("/:id/email", requirePermission("purchases:write"), json(emailSupplierSchema), async (c) => {
    const input = c.req.valid("json");
    const order = await loadOrder(c, c.req.param("id"));
    if (!order) throw notFound("Orden de compra");
    if (order.status === "cancelled") throw new AppError(409, "cancelled", "Esta orden está cancelada.");
    const settings = await getSettings(c);
    const money = (v: number) => formatMoney(v, settings.currency, settings.locale);
    const lines = order.items.map((i) => {
      const name = i.options.length ? `${i.name} (${i.options.join(" / ")})` : i.name;
      return `- ${formatQty(i.quantity, i.unit)} × ${name} [${i.sku}] a ${money(i.unitCostCents)} = ${money(i.netCents)}`;
    });
    const text = [
      input.message ?? `Hola${order.supplier.contactName ? ` ${order.supplier.contactName}` : ""}, te compartimos nuestra orden de compra.`,
      "",
      `Orden ${docNumber("purchase", order.number)} · ${settings.tradeName}`,
      `Entregar en: ${order.locationName}${order.expectedDate ? ` · Fecha esperada: ${order.expectedDate}` : ""}`,
      "",
      ...lines,
      "",
      `Subtotal: ${money(order.subtotalCents)}`,
      `Impuestos: ${money(order.taxCents)}`,
      `Total: ${money(order.totalCents)}`,
      order.note ? `\nNotas: ${order.note}` : "",
      "",
      [settings.tradeName, settings.phone, settings.email].filter(Boolean).join(" · "),
    ].join("\n");
    await sendEmail(c.env, { to: input.email, subject: `Orden de compra ${docNumber("purchase", order.number)} — ${settings.tradeName}`, text });
    const { d1 } = c.var.auth;
    await d1.batch([toStatement(d1, auditEntry(c, { action: "purchase.email", entity: "purchase_order", entityId: order.id, after: { email: input.email } }))]);
    return c.json({ ok: true });
  });
