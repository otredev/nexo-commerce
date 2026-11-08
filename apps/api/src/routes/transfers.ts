import { Hono, type Context } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import {
  can,
  docNumber,
  formatQty,
  fromMilli,
  quantityFitsUnit,
  receiveTransferSchema,
  toMilli,
  transferSchema,
  TRANSFER_STATUSES,
  unitInfo,
  type Paginated,
  type TransferDetail,
  type TransferListItem,
  type TransferStatus,
  type UnitCode,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { chunk, isStockCheckError, isTransitionError, movementStatements, toStatement, transitionStatement } from "../lib/inventory";
import { resolveLines, variantLabel } from "../lib/lines";
import { json } from "../lib/validate";
import { requirePermission, allowed } from "../middleware/auth";

const { transfers, transferItems, locations, stockLevels } = tenant;

const changed = () => new AppError(409, "status_changed", "El traspaso cambió mientras lo editabas. Recarga para ver su estado actual.");

async function loadTransfer(c: Context<AppEnv>, id: string): Promise<TransferDetail | null> {
  const { db, tenant: t } = c.var.auth;
  const tr = await db.select().from(transfers).where(and(eq(transfers.id, id), eq(transfers.tenantId, t.id))).get();
  if (!tr) return null;
  const [locs, items] = await Promise.all([
    db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.tenantId, t.id)),
    db.select().from(transferItems).where(eq(transferItems.transferId, id)).orderBy(asc(transferItems.position)),
  ]);
  const stock = new Map<string, number>();
  for (const part of chunk([...new Set(items.map((i) => i.variantId))])) {
    const levels = await db
      .select({ v: stockLevels.variantId, q: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.tenantId, t.id), eq(stockLevels.locationId, tr.fromLocationId), inArray(stockLevels.variantId, part)));
    levels.forEach((l) => stock.set(l.v, l.q));
  }
  const name = (lid: string) => locs.find((l) => l.id === lid)?.name ?? "—";
  return {
    id: tr.id,
    number: tr.number,
    status: tr.status,
    fromLocationId: tr.fromLocationId,
    fromLocationName: name(tr.fromLocationId),
    toLocationId: tr.toLocationId,
    toLocationName: name(tr.toLocationId),
    itemsCount: items.length,
    units: fromMilli(items.reduce((a, i) => a + i.quantity, 0)),
    note: tr.note,
    createdAt: tr.createdAt,
    createdByName: tr.createdByName,
    sentAt: tr.sentAt,
    sentByName: tr.sentByName,
    receivedAt: tr.receivedAt,
    receivedByName: tr.receivedByName,
    cancelledAt: tr.cancelledAt,
    cancelledByName: tr.cancelledByName,
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productId: i.productId,
      name: i.name,
      options: i.options,
      sku: i.sku,
      unit: i.unit as UnitCode,
      quantity: fromMilli(i.quantity),
      receivedQuantity: i.receivedQuantity === null ? null : fromMilli(i.receivedQuantity),
      unitCostCents: allowed(c.var.auth, "costs:read") ? i.unitCostCents : null,
      originStock: fromMilli(stock.get(i.variantId) ?? 0),
    })),
  };
}

async function getTransfer(c: Context<AppEnv>, id: string) {
  const { db, tenant: t } = c.var.auth;
  const tr = await db.select().from(transfers).where(and(eq(transfers.id, id), eq(transfers.tenantId, t.id))).get();
  if (!tr) throw notFound("Traspaso");
  return tr;
}

async function checkLocations(c: Context<AppEnv>, fromId: string, toId: string) {
  const { db, tenant: t } = c.var.auth;
  const locs = await db.select().from(locations).where(and(eq(locations.tenantId, t.id), inArray(locations.id, [fromId, toId])));
  const from = locs.find((l) => l.id === fromId);
  const to = locs.find((l) => l.id === toId);
  if (!from?.active) throw new AppError(422, "validation_error", "Revisa los campos marcados", { fromLocationId: "Elige una ubicación activa" });
  if (!to?.active) throw new AppError(422, "validation_error", "Revisa los campos marcados", { toLocationId: "Elige una ubicación activa" });
}

const itemRows = (c: Context<AppEnv>, transferId: string, lines: Awaited<ReturnType<typeof resolveLines>>) =>
  lines.map((l) => ({
    id: newId(), tenantId: c.var.auth.tenant.id, transferId, variantId: l.variantId, productId: l.productId, name: l.name, options: l.options,
    sku: l.sku, unit: l.unit, quantity: l.quantityMilli, position: l.position,
  }));

/** Explains which product is short at the origin after a CHECK failure. */
async function shortageError(c: Context<AppEnv>, locationId: string, items: Array<{ variantId: string; quantity: number; name: string; options: string[]; unit: string }>) {
  const { db, tenant: t } = c.var.auth;
  const levels = await db.select().from(stockLevels).where(and(eq(stockLevels.tenantId, t.id), eq(stockLevels.locationId, locationId), inArray(stockLevels.variantId, items.map((i) => i.variantId).slice(0, 90))));
  for (const i of items) {
    const have = levels.find((l) => l.variantId === i.variantId)?.quantity ?? 0;
    if (have < i.quantity) return new AppError(409, "insufficient_stock", `No hay suficiente ${variantLabel(i)} en el origen: hay ${formatQty(fromMilli(have), i.unit)}.`, { variantId: i.variantId });
  }
  return new AppError(409, "insufficient_stock", "No hay suficiente existencia en el origen para enviar el traspaso.");
}

const listQuery = z.object({
  status: z.enum(["all", "open", ...TRANSFER_STATUSES]).default("all"),
  locationId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const transferRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("transfers:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t } = c.var.auth;
    const params: unknown[] = [t.id];
    const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
    const where = ["tr.tenant_id = ?1"];
    if (query.status === "open") where.push("tr.status IN ('draft', 'in_transit')");
    else if (query.status !== "all") where.push(`tr.status = ${add(query.status)}`);
    if (query.locationId) {
      const p = add(query.locationId);
      where.push(`(tr.from_location_id = ${p} OR tr.to_location_id = ${p})`);
    }
    const from = `FROM transfers tr WHERE ${where.join(" AND ")}`;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1
        .prepare(
          `SELECT tr.*, lf.name AS from_name, lt.name AS to_name,
             (SELECT COUNT(*) FROM transfer_items i WHERE i.transfer_id = tr.id) AS items_count,
             (SELECT COALESCE(SUM(quantity), 0) FROM transfer_items i WHERE i.transfer_id = tr.id) AS units
           FROM transfers tr LEFT JOIN locations lf ON lf.id = tr.from_location_id LEFT JOIN locations lt ON lt.id = tr.to_location_id
           WHERE ${where.join(" AND ")} ORDER BY tr.number DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        )
        .bind(...params),
    ]);
    const items: TransferListItem[] = (rows!.results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      number: r.number as number,
      status: r.status as TransferStatus,
      fromLocationId: r.from_location_id as string,
      fromLocationName: (r.from_name as string | null) ?? "—",
      toLocationId: r.to_location_id as string,
      toLocationName: (r.to_name as string | null) ?? "—",
      itemsCount: r.items_count as number,
      units: fromMilli(r.units as number),
      createdAt: r.created_at as string,
      createdByName: r.created_by_name as string | null,
      sentAt: r.sent_at as string | null,
      receivedAt: r.received_at as string | null,
    }));
    const body: Paginated<TransferListItem> = { items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  .get("/:id", requirePermission("transfers:read"), async (c) => {
    const tr = await loadTransfer(c, c.req.param("id"));
    if (!tr) throw notFound("Traspaso");
    return c.json(tr);
  })

  .post("/", requirePermission("transfers:write"), json(transferSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    await checkLocations(c, input.fromLocationId, input.toLocationId);
    const lines = await resolveLines(c, input.items, "el traspaso");
    const id = newId();
    const now = new Date().toISOString();
    await d1.batch([
      d1.prepare("INSERT INTO counters (tenant_id, name, value) VALUES (?1, 'transfer', 1) ON CONFLICT(tenant_id, name) DO UPDATE SET value = value + 1").bind(t.id),
      d1
        .prepare(
          `INSERT INTO transfers (id, tenant_id, number, from_location_id, to_location_id, status, note, created_by, created_by_name, created_at, updated_at)
           SELECT ?1, ?2, value, ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?8 FROM counters WHERE tenant_id = ?2 AND name = 'transfer'`,
        )
        .bind(id, t.id, input.fromLocationId, input.toLocationId, input.note, user.id, user.name, now),
      ...itemRows(c, id, lines).map((row) => toStatement(d1, db.insert(transferItems).values(row))),
      toStatement(d1, auditEntry(c, { action: "transfer.create", entity: "transfer", entityId: id, after: { from: input.fromLocationId, to: input.toLocationId, lines: lines.length } })),
    ]);
    return c.json(await loadTransfer(c, id), 201);
  })

  .put("/:id", requirePermission("transfers:write"), json(transferSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t } = c.var.auth;
    const tr = await getTransfer(c, c.req.param("id"));
    if (tr.status !== "draft") throw new AppError(409, "not_editable", "Solo se editan traspasos en borrador.");
    await checkLocations(c, input.fromLocationId, input.toLocationId);
    const lines = await resolveLines(c, input.items, "el traspaso");
    try {
      await d1.batch([
        transitionStatement(d1, "transfers", { id: tr.id, tenantId: t.id }, ["draft"], "draft", {
          from_location_id: input.fromLocationId, to_location_id: input.toLocationId, note: input.note, updated_at: new Date().toISOString(),
        }),
        toStatement(d1, db.delete(transferItems).where(and(eq(transferItems.transferId, tr.id), eq(transferItems.tenantId, t.id)))),
        ...itemRows(c, tr.id, lines).map((row) => toStatement(d1, db.insert(transferItems).values(row))),
        toStatement(d1, auditEntry(c, { action: "transfer.update", entity: "transfer", entityId: tr.id, after: { lines: lines.length } })),
      ]);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadTransfer(c, tr.id));
  })

  /** Draft → in transit: the goods leave the origin (stock out, fails if short) at their average cost. */
  .post("/:id/send", requirePermission("transfers:write"), async (c) => {
    const { db, d1, tenant: t, user } = c.var.auth;
    const tr = await getTransfer(c, c.req.param("id"));
    if (tr.status !== "draft") throw new AppError(409, "not_draft", "Este traspaso ya fue enviado.");
    await checkLocations(c, tr.fromLocationId, tr.toLocationId);
    const items = await db.select().from(transferItems).where(and(eq(transferItems.transferId, tr.id), eq(transferItems.tenantId, t.id)));
    const now = new Date().toISOString();
    const actor = { tenantId: t.id, userId: user.id, userName: user.name };
    const label = docNumber("transfer", tr.number);
    const statements: D1PreparedStatement[] = [
      transitionStatement(d1, "transfers", { id: tr.id, tenantId: t.id }, ["draft"], "in_transit", { sent_at: now, sent_by_name: user.name, updated_at: now }),
      d1
        .prepare("UPDATE transfer_items SET unit_cost_cents = (SELECT cost_cents FROM variants WHERE variants.id = transfer_items.variant_id) WHERE transfer_id = ?1 AND tenant_id = ?2")
        .bind(tr.id, t.id),
    ];
    for (const i of items) {
      statements.push(...movementStatements(d1, actor, { kind: "out", type: "transfer_out", variantId: i.variantId, locationId: tr.fromLocationId, quantityMilli: i.quantity, reason: "transfer", reference: tr.id, note: label }));
    }
    statements.push(toStatement(d1, auditEntry(c, { action: "transfer.send", entity: "transfer", entityId: tr.id, after: { number: tr.number, lines: items.length } })));
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      if (isStockCheckError(err)) throw await shortageError(c, tr.fromLocationId, items);
      throw err;
    }
    return c.json(await loadTransfer(c, tr.id));
  })

  /** In transit → received: what arrived enters the destination. Missing units are recorded as a difference. */
  .post("/:id/receive", requirePermission("transfers:receive"), json(receiveTransferSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    const tr = await getTransfer(c, c.req.param("id"));
    if (tr.status !== "in_transit") throw new AppError(409, "not_in_transit", tr.status === "draft" ? "Este traspaso aún no se envía." : "Este traspaso ya está cerrado.");
    const items = await db.select().from(transferItems).where(and(eq(transferItems.transferId, tr.id), eq(transferItems.tenantId, t.id)));
    const given = new Map(input.items.map((i) => [i.itemId, i.receivedQuantity]));
    if (given.size !== items.length || items.some((i) => !given.has(i.id))) throw new AppError(422, "validation_error", "Indica lo recibido de cada producto del traspaso.");
    const now = new Date().toISOString();
    const actor = { tenantId: t.id, userId: user.id, userName: user.name };
    const label = docNumber("transfer", tr.number);
    const statements: D1PreparedStatement[] = [
      transitionStatement(d1, "transfers", { id: tr.id, tenantId: t.id }, ["in_transit"], "received", { received_at: now, received_by_name: user.name, updated_at: now, note: input.note ? [tr.note, `Recepción: ${input.note}`].filter(Boolean).join("\n") : tr.note }),
    ];
    let missing = 0;
    items.forEach((i, n) => {
      const q = given.get(i.id)!;
      if (!quantityFitsUnit(q, i.unit)) {
        throw new AppError(422, "validation_error", `${i.name}: ${unitInfo(i.unit).decimals ? "máximo 3 decimales" : "usa cantidades enteras"}`, { [`items.${n}.receivedQuantity`]: "Cantidad no válida" });
      }
      const milli = toMilli(q);
      if (milli > i.quantity) {
        throw new AppError(422, "validation_error", `${variantLabel(i)}: se enviaron ${formatQty(fromMilli(i.quantity), i.unit)}.`, { [`items.${n}.receivedQuantity`]: `Máximo ${formatQty(fromMilli(i.quantity), i.unit)}` });
      }
      if (milli < i.quantity) missing++;
      statements.push(d1.prepare("UPDATE transfer_items SET received_quantity = ?1 WHERE id = ?2 AND tenant_id = ?3").bind(milli, i.id, t.id));
      if (milli > 0) {
        statements.push(...movementStatements(d1, actor, { kind: "in", type: "transfer_in", variantId: i.variantId, locationId: tr.toLocationId, quantityMilli: milli, unitCostCents: null, reason: "transfer", reference: tr.id, note: label }));
      }
    });
    statements.push(toStatement(d1, auditEntry(c, { action: "transfer.receive", entity: "transfer", entityId: tr.id, after: { number: tr.number, linesWithDifference: missing } })));
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadTransfer(c, tr.id));
  })

  /** Draft → cancelled, or in transit → cancelled returning everything to the origin. */
  .post("/:id/cancel", requirePermission("transfers:write"), async (c) => {
    const { db, d1, tenant: t, user } = c.var.auth;
    const tr = await getTransfer(c, c.req.param("id"));
    if (tr.status !== "draft" && tr.status !== "in_transit") throw new AppError(409, "closed", "Este traspaso ya está cerrado.");
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      transitionStatement(d1, "transfers", { id: tr.id, tenantId: t.id }, [tr.status], "cancelled", { cancelled_at: now, cancelled_by_name: user.name, updated_at: now }),
    ];
    if (tr.status === "in_transit") {
      const items = await db.select().from(transferItems).where(and(eq(transferItems.transferId, tr.id), eq(transferItems.tenantId, t.id)));
      const actor = { tenantId: t.id, userId: user.id, userName: user.name };
      for (const i of items) {
        statements.push(...movementStatements(d1, actor, { kind: "in", type: "transfer_in", variantId: i.variantId, locationId: tr.fromLocationId, quantityMilli: i.quantity, unitCostCents: null, reason: "transfer_cancel", reference: tr.id, note: docNumber("transfer", tr.number) }));
      }
    }
    statements.push(toStatement(d1, auditEntry(c, { action: "transfer.cancel", entity: "transfer", entityId: tr.id, after: { number: tr.number, wasInTransit: tr.status === "in_transit" } })));
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isTransitionError(err)) throw changed();
      throw err;
    }
    return c.json(await loadTransfer(c, tr.id));
  });
