import { Hono } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import {
  businessDate,
  can,
  computeSale,
  couponProblem,
  priceCart,
  emailReceiptSchema,
  formatFolio,
  formatMoney,
  formatQty,
  fromMilli,
  paymentLabel,
  quantityFitsUnit,
  returnInputSchema,
  saleInputSchema,
  settle,
  toMilli,
  unitInfo,
  voidSaleSchema,
  type Paginated,
  type SaleListItem,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { sendEmail } from "../lib/email";
import { AppError, notFound } from "../lib/errors";
import { chunk, isCheckError, isStockCheckError, isUniqueError, movementStatements, toStatement } from "../lib/inventory";
import { couponUseStatement, findCoupon, livePromotions, toCouponRule } from "../lib/pricing";
import { dailyProductUpsert, dailySalesUpsert, getSettings, loadSale, openSessionFor, sessionTotals } from "../lib/sales";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { variants, products, taxRates, stockLevels, saleItems, salePayments, saleReturns, saleReturnItems, sales, locations, customers } = tenant;

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["all", "completed", "voided"]).default("all"),
  locationId: z.string().max(40).optional(),
  sessionId: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const saleRoutes = new Hono<AppEnv>()
  /* ---------- Create a sale: one atomic batch ---------- */
  .post("/", requirePermission("pos:sell"), json(saleInputSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t, user, role } = c.var.auth;

    // Idempotency: the POS retries with the same clientId after a network error.
    const existing = await db.select({ id: sales.id }).from(sales).where(and(eq(sales.tenantId, t.id), eq(sales.clientId, input.clientId))).get();
    if (existing) return c.json(await loadSale(c, existing.id), 200);

    const settings = await getSettings(c);
    const session = await openSessionFor(c, input.locationId);
    if (!session) throw new AppError(409, "cash_closed", "La caja de esta ubicación está cerrada. Ábrela para vender.");

    // Current prices, taxes and costs from the database: the client only says what and how much.
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    const rows: Array<{ id: string; productId: string; sku: string; options: string[]; price: number; cost: number; name: string; unit: string; track: boolean; taxRateId: string | null; categoryId: string | null }> = [];
    for (const part of chunk(ids, 80)) {
      rows.push(
        ...(await db
          .select({
            id: variants.id, productId: variants.productId, sku: variants.sku, options: variants.options, price: variants.priceCents, cost: variants.costCents,
            name: products.name, unit: products.unit, track: products.trackInventory, taxRateId: products.taxRateId, categoryId: products.categoryId,
          })
          .from(variants)
          .innerJoin(products, eq(products.id, variants.productId))
          .where(and(eq(variants.tenantId, t.id), inArray(variants.id, part), isNull(variants.deletedAt), eq(variants.active, true), isNull(products.deletedAt), eq(products.status, "active")))),
      );
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = input.items.findIndex((i) => !byId.has(i.variantId));
    if (missing >= 0) throw new AppError(409, "unavailable", "Un producto del carrito ya no está disponible. Quítalo e intenta de nuevo.", { [`items.${missing}`]: "No disponible" });
    const taxes = await db.select().from(taxRates).where(eq(taxRates.tenantId, t.id));
    const defaultRate = taxes.find((x) => x.isDefault)?.rateBps ?? 0;
    const rateOf = (taxRateId: string | null) => (taxRateId ? (taxes.find((x) => x.id === taxRateId)?.rateBps ?? defaultRate) : defaultRate);

    input.items.forEach((item, i) => {
      const v = byId.get(item.variantId)!;
      if (!quantityFitsUnit(item.quantity, v.unit)) {
        throw new AppError(422, "validation_error", `${v.name}: ${unitInfo(v.unit).decimals ? "máximo 3 decimales" : "usa cantidades enteras"}`, { [`items.${i}.quantity`]: "Cantidad no válida" });
      }
    });
    const lines = input.items.map((item) => {
      const v = byId.get(item.variantId)!;
      return { unitPriceCents: v.price, quantity: item.quantity, discountCents: item.discountCents, taxRateBps: rateOf(v.taxRateId) };
    });
    // Promotions and coupon: the same pricing the POS showed.
    const today = businessDate(settings.timezone);
    const promos = await livePromotions(db, t.id, today, "pos");
    const coupon = input.couponCode ? await findCoupon(db, t.id, input.couponCode) : null;
    if (input.couponCode) {
      const problem = coupon ? couponProblem(toCouponRule(coupon), today, "pos") : "Este cupón no existe.";
      if (problem) throw new AppError(422, "coupon_invalid", problem, { couponCode: problem });
    }
    const priced = priceCart(
      input.items.map((item, i) => {
        const v = byId.get(item.variantId)!;
        return { productId: v.productId, categoryId: v.categoryId, unitPriceCents: v.price, quantity: item.quantity, taxRateBps: lines[i]!.taxRateBps, manualDiscountCents: item.discountCents };
      }),
      { promotions: promos, coupon: coupon ? toCouponRule(coupon) : null, manualCartDiscountCents: input.discountCents, pricesIncludeTax: settings.pricesIncludeTax, formatMoney: (v) => formatMoney(v, settings.currency, settings.locale) },
    );
    if (priced.couponError) throw new AppError(422, "coupon_invalid", priced.couponError, { couponCode: priced.couponError });
    const totals = priced.totals;
    // The cashier's limit applies only to discounts given by hand, not to promotions or coupons.
    if (priced.manualDiscountCents > 0 && !can(role, "discount:unlimited") && priced.manualDiscountCents * 10_000 > totals.subtotalCents * settings.cashierMaxDiscountBps) {
      throw new AppError(403, "discount_limit", `Tu descuento máximo es ${settings.cashierMaxDiscountBps / 100} % del subtotal. Pide autorización a un administrador.`);
    }
    // Customer record: its name and contact go on the receipt.
    let customerName = input.customerName;
    let customerContact = input.customerContact;
    if (input.customerId) {
      const cust = await db.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, t.id))).get();
      if (!cust) throw new AppError(422, "validation_error", "El cliente ya no existe.", { customerId: "No encontrado" });
      customerName = cust.name;
      customerContact = cust.email ?? cust.phone ?? null;
    }
    const settled = settle(totals.totalCents, input.payments);
    if (!settled.ok) throw new AppError(422, "payment_error", settled.message);

    const saleId = newId();
    const date = today;
    const now = new Date().toISOString();
    const costs = input.items.map((item) => Math.round((byId.get(item.variantId)!.cost * toMilli(item.quantity)) / 1000));
    const totalCost = costs.reduce((a, b) => a + b, 0);
    const actor = { tenantId: t.id, userId: user.id, userName: user.name };

    const statements: D1PreparedStatement[] = [
      d1.prepare("INSERT INTO counters (tenant_id, name, value) VALUES (?1, 'sale', 1) ON CONFLICT(tenant_id, name) DO UPDATE SET value = value + 1").bind(t.id),
      d1
        .prepare(
          `INSERT INTO sales (id, tenant_id, number, client_id, location_id, session_id, user_id, user_name, customer_name, customer_contact, note, status,
             prices_include_tax, subtotal_cents, discount_cents, tax_cents, total_cents, cost_cents, paid_cents, change_cents, business_date, created_at,
             customer_id, coupon_code, promo_discount_cents)
           SELECT ?1, ?2, value, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'completed', ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
           FROM counters WHERE tenant_id = ?2 AND name = 'sale'`,
        )
        .bind(
          saleId, t.id, input.clientId, input.locationId, session.id, user.id, user.name, customerName, customerContact, input.note,
          settings.pricesIncludeTax ? 1 : 0, totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents, totalCost,
          settled.paidCents, settled.changeCents, date, now, input.customerId, coupon?.code ?? null, priced.promoDiscountCents,
        ),
      ...(coupon ? [couponUseStatement(d1, coupon.id)] : []),
    ];
    input.items.forEach((item, i) => {
      const v = byId.get(item.variantId)!;
      const l = totals.lines[i]!;
      statements.push(
        toStatement(
          d1,
          db.insert(saleItems).values({
            id: newId(), tenantId: t.id, saleId, variantId: v.id, productId: v.productId, name: v.name, options: v.options, sku: v.sku, unit: v.unit,
            trackInventory: v.track, quantity: toMilli(item.quantity), unitPriceCents: v.price, discountCents: l.lineDiscountCents + l.cartDiscountCents,
            taxRateBps: lines[i]!.taxRateBps, netCents: l.netCents, taxCents: l.taxCents, totalCents: l.totalCents, unitCostCents: v.cost, position: i,
            promotionId: priced.lines[i]!.promotionId,
          }),
        ),
      );
    });
    for (const p of input.payments) {
      statements.push(toStatement(d1, db.insert(salePayments).values({ id: newId(), tenantId: t.id, saleId, method: p.method, amountCents: p.amountCents, reference: p.reference })));
    }
    // Stock: fails the whole batch (and the sale) if anything is short.
    input.items.forEach((item) => {
      const v = byId.get(item.variantId)!;
      if (v.track) {
        statements.push(...movementStatements(d1, actor, { kind: "out", type: "sale", variantId: v.id, locationId: input.locationId, quantityMilli: toMilli(item.quantity), reason: "sale", reference: saleId }));
      }
    });
    statements.push(dailySalesUpsert(d1, { tenantId: t.id, date, locationId: input.locationId, count: 1, total: totals.totalCents, discount: totals.discountCents, tax: totals.taxCents, cost: totalCost, returns: 0, voided: 0 }));
    const perVariant = new Map<string, { productId: string; quantity: number; total: number; cost: number }>();
    input.items.forEach((item, i) => {
      const v = byId.get(item.variantId)!;
      const agg = perVariant.get(v.id) ?? { productId: v.productId, quantity: 0, total: 0, cost: 0 };
      agg.quantity += toMilli(item.quantity);
      agg.total += totals.lines[i]!.totalCents;
      agg.cost += costs[i]!;
      perVariant.set(v.id, agg);
    });
    for (const [variantId, agg] of perVariant) statements.push(dailyProductUpsert(d1, { tenantId: t.id, date, variantId, ...agg }));

    try {
      await d1.batch(statements);
    } catch (err) {
      if (isCheckError(err, "coupons_uses_le_max")) throw new AppError(409, "coupon_exhausted", "El cupón se agotó justo ahora. Quítalo para cobrar.", { couponCode: "Se agotó" });
      if (isUniqueError(err) && String((err as Error).message).includes("client_id")) {
        const again = await db.select({ id: sales.id }).from(sales).where(and(eq(sales.tenantId, t.id), eq(sales.clientId, input.clientId))).get();
        if (again) return c.json(await loadSale(c, again.id), 200);
      }
      if (!isStockCheckError(err)) throw err;
      // Find which product is short to give a useful message.
      const levels = await db.select().from(stockLevels).where(and(eq(stockLevels.tenantId, t.id), eq(stockLevels.locationId, input.locationId), inArray(stockLevels.variantId, ids)));
      const needed = new Map<string, number>();
      input.items.forEach((i) => needed.set(i.variantId, (needed.get(i.variantId) ?? 0) + toMilli(i.quantity)));
      for (const [variantId, qty] of needed) {
        const v = byId.get(variantId)!;
        const have = levels.find((l) => l.variantId === variantId)?.quantity ?? 0;
        if (v.track && have < qty) {
          const label = v.options.length ? `${v.name} (${v.options.join(" / ")})` : v.name;
          throw new AppError(409, "insufficient_stock", `No hay suficiente ${label}: quedan ${formatQty(fromMilli(have), v.unit)}.`, { variantId });
        }
      }
      throw new AppError(409, "insufficient_stock", "No hay suficiente existencia para completar la venta.");
    }
    return c.json(await loadSale(c, saleId), 201);
  })

  /* ---------- History ---------- */
  .get("/", requirePermission("sales:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { d1, tenant: t } = c.var.auth;
    const params: unknown[] = [t.id];
    const add = (v: unknown) => { params.push(v); return `?${params.length}`; };
    const where = ["s.tenant_id = ?1"];
    if (query.from) where.push(`s.business_date >= ${add(query.from)}`);
    if (query.to) where.push(`s.business_date <= ${add(query.to)}`);
    if (query.status !== "all") where.push(`s.status = ${add(query.status)}`);
    if (query.locationId) where.push(`s.location_id = ${add(query.locationId)}`);
    if (query.sessionId) where.push(`s.session_id = ${add(query.sessionId)}`);
    if (query.q) {
      const q = query.q.trim().replace(/^#/, "");
      if (/^\d+$/.test(q)) where.push(`s.number = ${add(Number(q))}`);
      else where.push(`instr(lower(COALESCE(s.customer_name, '') || ' ' || COALESCE(s.customer_contact, '')), lower(${add(q)})) > 0`);
    }
    const from = `FROM sales s LEFT JOIN locations l ON l.id = s.location_id WHERE ${where.join(" AND ")}`;
    const offset = (query.page - 1) * query.pageSize;
    const [count, rows] = await d1.batch([
      d1.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...params),
      d1
        .prepare(
          `SELECT s.id, s.number, s.status, s.created_at, s.user_name, s.customer_name, l.name AS location_name, s.total_cents, s.refunded_cents,
             (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS item_count,
             (SELECT group_concat(DISTINCT p.method) FROM sale_payments p WHERE p.sale_id = s.id) AS methods
           ${from} ORDER BY s.number DESC LIMIT ${query.pageSize} OFFSET ${offset}`,
        )
        .bind(...params),
    ]);
    const items: SaleListItem[] = (rows!.results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      number: r.number as number,
      status: r.status as "completed" | "voided",
      createdAt: r.created_at as string,
      userName: r.user_name as string | null,
      customerName: r.customer_name as string | null,
      locationName: (r.location_name as string | null) ?? "—",
      itemCount: r.item_count as number,
      totalCents: r.total_cents as number,
      refundedCents: r.refunded_cents as number,
      methods: ((r.methods as string | null) ?? "").split(",").filter(Boolean),
    }));
    const body: Paginated<SaleListItem> = { items, total: (count!.results[0] as { total: number }).total, page: query.page, pageSize: query.pageSize };
    return c.json(body);
  })

  .get("/:id", requirePermission("sales:read"), async (c) => {
    const sale = await loadSale(c, c.req.param("id"));
    if (!sale) throw notFound("Venta");
    return c.json(sale);
  })

  /* ---------- Void: only during the same open cash session, before any return ---------- */
  .post("/:id/void", requirePermission("sales:void"), json(voidSaleSchema), async (c) => {
    const { reason } = c.req.valid("json");
    const id = c.req.param("id");
    const { db, d1, tenant: t, user } = c.var.auth;
    const sale = await loadSale(c, id);
    if (!sale) throw notFound("Venta");
    if (sale.status === "voided") throw new AppError(409, "already_voided", "Esta venta ya está anulada");
    if (!sale.voidable) {
      throw new AppError(409, "not_voidable", sale.returns.length ? "La venta tiene devoluciones; no se puede anular." : "Solo se anulan ventas del turno de caja abierto. Para ventas anteriores registra una devolución.");
    }
    const itemsRows = await db.select().from(saleItems).where(eq(saleItems.saleId, id));
    const saleRow = await db.select().from(sales).where(eq(sales.id, id)).get();
    const now = new Date().toISOString();
    const actor = { tenantId: t.id, userId: user.id, userName: user.name };
    const statements: D1PreparedStatement[] = [
      d1.prepare("UPDATE sales SET status = 'voided', voided_at = ?1, voided_by = ?2, void_reason = ?3 WHERE id = ?4 AND tenant_id = ?5 AND status = 'completed'").bind(now, user.name, reason, id, t.id),
    ];
    for (const item of itemsRows) {
      if (item.trackInventory) {
        statements.push(...movementStatements(d1, actor, { kind: "in", type: "return", variantId: item.variantId, locationId: sale.locationId, quantityMilli: item.quantity, unitCostCents: item.unitCostCents, reason: "void", reference: id }));
      }
      statements.push(dailyProductUpsert(d1, { tenantId: t.id, date: sale.businessDate, variantId: item.variantId, productId: item.productId, quantity: -item.quantity, total: -item.totalCents, cost: -Math.round((item.unitCostCents * item.quantity) / 1000) }));
    }
    statements.push(dailySalesUpsert(d1, { tenantId: t.id, date: sale.businessDate, locationId: sale.locationId, count: -1, total: -sale.totalCents, discount: -sale.discountCents, tax: -sale.taxCents, cost: -(saleRow?.costCents ?? 0), returns: 0, voided: 1 }));
    statements.push(toStatement(d1, auditEntry(c, { action: "sale.void", entity: "sale", entityId: id, after: { number: sale.number, totalCents: sale.totalCents, reason } })));
    await d1.batch(statements);
    return c.json(await loadSale(c, id));
  })

  /* ---------- Return (partial or total) ---------- */
  .post("/:id/returns", requirePermission("sales:return"), json(returnInputSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const { db, d1, tenant: t, user } = c.var.auth;
    const sale = await db.select().from(sales).where(and(eq(sales.id, id), eq(sales.tenantId, t.id))).get();
    if (!sale) throw notFound("Venta");
    if (sale.status !== "completed") throw new AppError(409, "voided", "La venta está anulada");
    const location = await db.select().from(locations).where(and(eq(locations.id, input.locationId), eq(locations.tenantId, t.id))).get();
    if (!location) throw notFound("Ubicación");
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, id));
    const prevReturned = await db
      .select({ saleItemId: saleReturnItems.saleItemId, refund: saleReturnItems.refundCents })
      .from(saleReturnItems)
      .innerJoin(saleReturns, eq(saleReturns.id, saleReturnItems.returnId))
      .where(eq(saleReturns.saleId, id));

    const settings = await getSettings(c);
    const date = businessDate(settings.timezone);
    const lines = input.items.map((r, i) => {
      const item = items.find((x) => x.id === r.saleItemId);
      if (!item) throw new AppError(422, "validation_error", "Revisa los campos marcados", { [`items.${i}`]: "No pertenece a esta venta" });
      const qty = toMilli(r.quantity);
      if (!quantityFitsUnit(r.quantity, item.unit)) throw new AppError(422, "validation_error", "Revisa los campos marcados", { [`items.${i}.quantity`]: "Cantidad no válida" });
      const available = item.quantity - item.returnedQuantity;
      if (qty > available) throw new AppError(422, "validation_error", `Solo puedes devolver ${formatQty(fromMilli(available), item.unit)} de ${item.name}`, { [`items.${i}.quantity`]: `Máximo ${fromMilli(available)}` });
      // The last units take whatever is left of the line, so rounding never leaves cents behind.
      const refunded = prevReturned.filter((p) => p.saleItemId === item.id).reduce((a, p) => a + p.refund, 0);
      const refund = qty === available ? item.totalCents - refunded : Math.round((item.totalCents * qty) / item.quantity);
      return { item, qty, refund, cost: Math.round((item.unitCostCents * qty) / 1000) };
    });
    const refundCents = lines.reduce((a, l) => a + l.refund, 0);

    let sessionId: string | null = null;
    if (input.refundMethod === "cash") {
      const session = await openSessionFor(c, input.locationId);
      if (!session) throw new AppError(409, "cash_closed", "Para reembolsar en efectivo, abre la caja de esa ubicación.");
      const totals = await sessionTotals(d1, t.id, session.id, session.openingCashCents);
      if (refundCents > totals.expectedCashCents) throw new AppError(409, "not_enough_cash", `No hay suficiente efectivo en caja (${formatMoney(totals.expectedCashCents, settings.currency, settings.locale)}).`);
      sessionId = session.id;
    }

    const returnId = newId();
    const actor = { tenantId: t.id, userId: user.id, userName: user.name };
    const statements: D1PreparedStatement[] = [
      toStatement(d1, db.insert(saleReturns).values({ id: returnId, tenantId: t.id, saleId: id, locationId: input.locationId, sessionId, refundMethod: input.refundMethod, refundCents, restock: input.restock, reason: input.reason, userId: user.id, userName: user.name, businessDate: date })),
      d1.prepare("UPDATE sales SET refunded_cents = refunded_cents + ?1 WHERE id = ?2 AND tenant_id = ?3").bind(refundCents, id, t.id),
    ];
    let restockedCost = 0;
    for (const l of lines) {
      statements.push(
        toStatement(d1, db.insert(saleReturnItems).values({ id: newId(), tenantId: t.id, returnId, saleItemId: l.item.id, quantity: l.qty, refundCents: l.refund })),
        // CHECK (returned_quantity <= quantity) protects against two simultaneous returns of the same line.
        d1.prepare("UPDATE sale_items SET returned_quantity = returned_quantity + ?1 WHERE id = ?2 AND tenant_id = ?3").bind(l.qty, l.item.id, t.id),
      );
      if (input.restock && l.item.trackInventory) {
        restockedCost += l.cost;
        statements.push(...movementStatements(d1, actor, { kind: "in", type: "return", variantId: l.item.variantId, locationId: input.locationId, quantityMilli: l.qty, unitCostCents: l.item.unitCostCents, reason: "return_restock", note: input.reason, reference: id }));
      }
      statements.push(dailyProductUpsert(d1, { tenantId: t.id, date, variantId: l.item.variantId, productId: l.item.productId, quantity: -l.qty, total: -l.refund, cost: input.restock ? -l.cost : 0 }));
    }
    statements.push(dailySalesUpsert(d1, { tenantId: t.id, date, locationId: input.locationId, count: 0, total: 0, discount: 0, tax: 0, cost: -restockedCost, returns: refundCents, voided: 0 }));
    statements.push(toStatement(d1, auditEntry(c, { action: "sale.return", entity: "sale", entityId: id, after: { number: sale.number, refundCents, refundMethod: input.refundMethod, restock: input.restock, reason: input.reason } })));
    try {
      await d1.batch(statements);
    } catch (err) {
      if (isStockCheckError(err)) throw new AppError(409, "already_returned", "Otra devolución de esta venta se registró al mismo tiempo. Recarga e intenta de nuevo.");
      throw err;
    }
    return c.json(await loadSale(c, id), 201);
  })

  /* ---------- Email receipt ---------- */
  .post("/:id/email", requirePermission("pos:sell"), json(emailReceiptSchema), async (c) => {
    const { email } = c.req.valid("json");
    const sale = await loadSale(c, c.req.param("id"));
    if (!sale) throw notFound("Venta");
    const s = await getSettings(c);
    const money = (v: number) => formatMoney(v, s.currency, s.locale);
    const lines = sale.items.map((i) => `${formatQty(i.quantity, i.unit)}  ${i.name}${i.options.length ? ` (${i.options.join(" / ")})` : ""}  ${money(i.totalCents)}`);
    const text = [
      s.tradeName,
      [s.legalName, s.taxId].filter(Boolean).join(" · "),
      s.address ?? "",
      "",
      `Venta ${formatFolio(sale.number)} · ${new Date(sale.createdAt).toLocaleString(s.locale, { timeZone: s.timezone })}`,
      sale.status === "voided" ? "VENTA ANULADA" : "",
      "",
      ...lines,
      "",
      `Subtotal: ${money(sale.subtotalCents)}`,
      sale.discountCents ? `Descuento: -${money(sale.discountCents)}` : "",
      `Impuestos${sale.pricesIncludeTax ? " incluidos" : ""}: ${money(sale.taxCents)}`,
      `Total: ${money(sale.totalCents)}`,
      ...sale.payments.map((p) => `${paymentLabel(p.method)}: ${money(p.amountCents)}`),
      sale.changeCents ? `Cambio: ${money(sale.changeCents)}` : "",
      "",
      s.receiptFooter ?? "¡Gracias por tu compra!",
    ].filter((l, i, all) => l !== "" || all[i - 1] !== "");
    c.executionCtx.waitUntil(sendEmail(c.env, { to: email, subject: `Tu recibo de ${s.tradeName} ${formatFolio(sale.number)}`, text: text.join("\n") }));
    return c.body(null, 204);
  });

