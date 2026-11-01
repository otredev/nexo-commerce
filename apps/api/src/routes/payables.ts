/**
 * Accounts payable: each purchase receipt is a supplier invoice (net + tax) with a due date.
 * Payments are recorded against one invoice, partially or in full, optionally from the cash drawer.
 */
import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import { businessDate, docNumber, formatMoney, supplierPaymentSchema, type Payable, type PayablesSummary } from "@nexo/shared";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { toStatement } from "../lib/inventory";
import { getSettings, openSessionFor, sessionTotals } from "../lib/sales";
import { json } from "../lib/validate";
import { requirePermission } from "../middleware/auth";

const { supplierPayments } = tenant;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const listQuery = z.object({
  status: z.enum(["open", "overdue", "paid", "all"]).default("open"),
  supplierId: z.string().max(40).optional(),
});

const SELECT = `
  SELECT r.id, r.order_id, o.number, o.supplier_id, s.name AS supplier_name, r.supplier_reference, r.created_at, r.due_date,
    r.amount_due_cents, r.paid_cents
  FROM purchase_receipts r JOIN purchase_orders o ON o.id = r.order_id JOIN suppliers s ON s.id = o.supplier_id`;

type Row = { id: string; order_id: string; number: number; supplier_id: string; supplier_name: string; supplier_reference: string | null; created_at: string; due_date: string | null; amount_due_cents: number; paid_cents: number };

export const payableRoutes = new Hono<AppEnv>()
  .get("/", requirePermission("payables:read"), async (c) => {
    const query = listQuery.parse(c.req.query());
    const { db, d1, tenant: t } = c.var.auth;
    const today = businessDate((await getSettings(c)).timezone);
    const params: unknown[] = [t.id];
    const where = ["r.tenant_id = ?1", "r.amount_due_cents > 0"];
    if (query.status === "open") where.push("r.paid_cents < r.amount_due_cents");
    if (query.status === "paid") where.push("r.paid_cents >= r.amount_due_cents");
    if (query.status === "overdue") { params.push(today); where.push(`r.paid_cents < r.amount_due_cents AND r.due_date < ?${params.length}`); }
    if (query.supplierId) { params.push(query.supplierId); where.push(`o.supplier_id = ?${params.length}`); }
    const { results } = await d1
      .prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY (r.paid_cents >= r.amount_due_cents), r.due_date IS NULL, r.due_date, r.created_at LIMIT 300`)
      .bind(...params)
      .all<Row>();
    const ids = results.map((r) => r.id);
    const payments = ids.length
      ? (await Promise.all(Array.from({ length: Math.ceil(ids.length / 90) }, (_, i) =>
          db.select().from(supplierPayments).where(and(eq(supplierPayments.tenantId, t.id), inArray(supplierPayments.receiptId, ids.slice(i * 90, i * 90 + 90)))).orderBy(desc(supplierPayments.createdAt)),
        ))).flat()
      : [];
    const items: Payable[] = results.map((r) => ({
      receiptId: r.id,
      orderId: r.order_id,
      orderNumber: r.number,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierReference: r.supplier_reference,
      receivedAt: r.created_at,
      dueDate: r.due_date,
      amountDueCents: r.amount_due_cents,
      paidCents: r.paid_cents,
      balanceCents: r.amount_due_cents - r.paid_cents,
      daysToDue: r.due_date ? daysBetween(today, r.due_date) : null,
      payments: payments.filter((p) => p.receiptId === r.id).map((p) => ({ id: p.id, amountCents: p.amountCents, method: p.method, reference: p.reference, paidOn: p.paidOn, userName: p.userName, note: p.note })),
    }));

    // Summary over every open invoice (not only the filtered list).
    const { results: open } = await d1
      .prepare(`${SELECT} WHERE r.tenant_id = ?1 AND r.paid_cents < r.amount_due_cents`)
      .bind(t.id)
      .all<Row>();
    const soon = (r: Row) => r.due_date !== null && r.due_date >= today && daysBetween(today, r.due_date) <= 7;
    const overdue = (r: Row) => r.due_date !== null && r.due_date < today;
    const bySupplier = new Map<string, PayablesSummary["bySupplier"][number]>();
    for (const r of open) {
      const s = bySupplier.get(r.supplier_id) ?? { supplierId: r.supplier_id, supplierName: r.supplier_name, balanceCents: 0, overdueCents: 0 };
      s.balanceCents += r.amount_due_cents - r.paid_cents;
      if (overdue(r)) s.overdueCents += r.amount_due_cents - r.paid_cents;
      bySupplier.set(r.supplier_id, s);
    }
    const summary: PayablesSummary = {
      openCents: open.reduce((a, r) => a + r.amount_due_cents - r.paid_cents, 0),
      overdueCents: open.filter(overdue).reduce((a, r) => a + r.amount_due_cents - r.paid_cents, 0),
      dueSoonCents: open.filter(soon).reduce((a, r) => a + r.amount_due_cents - r.paid_cents, 0),
      bySupplier: [...bySupplier.values()].sort((a, b) => b.balanceCents - a.balanceCents),
    };
    return c.json({ items, summary, today });
  })

  /**
   * Pays an invoice (all or part). The balance can never go below zero, even with two payments
   * at once: paid_cents only grows while it stays ≤ amount_due_cents (else NULL → NOT NULL fails).
   */
  .post("/:receiptId/payments", requirePermission("payables:write"), json(supplierPaymentSchema), async (c) => {
    const input = c.req.valid("json");
    const { d1, tenant: t, user } = c.var.auth;
    const r = await d1.prepare(`${SELECT} WHERE r.id = ?1 AND r.tenant_id = ?2`).bind(c.req.param("receiptId"), t.id).first<Row & { location_id?: string }>();
    if (!r) throw notFound("Factura");
    const location = await d1.prepare("SELECT location_id FROM purchase_receipts WHERE id = ?1").bind(r.id).first<{ location_id: string }>();
    const balance = r.amount_due_cents - r.paid_cents;
    const settings = await getSettings(c);
    const money = (v: number) => formatMoney(v, settings.currency, settings.locale);
    if (input.amountCents > balance) throw new AppError(422, "validation_error", "Revisa los campos marcados", { amountCents: `El saldo es ${money(balance)}` });
    const id = newId();
    const now = new Date().toISOString();
    const label = `${docNumber("purchase", r.number)}${r.supplier_reference ? ` · Factura ${r.supplier_reference}` : ""}`;
    const statements: D1PreparedStatement[] = [];
    let sessionId: string | null = null;
    if (input.fromCashDrawer) {
      if (input.method !== "cash") throw new AppError(422, "validation_error", "Revisa los campos marcados", { method: "Solo el efectivo sale de la caja" });
      const session = await openSessionFor(c, location!.location_id);
      if (!session) throw new AppError(409, "cash_closed", "La caja de la ubicación que recibió la mercancía está cerrada.");
      const totals = await sessionTotals(d1, t.id, session.id, session.openingCashCents);
      if (input.amountCents > totals.expectedCashCents) throw new AppError(409, "not_enough_cash", `No hay suficiente efectivo en caja (${money(totals.expectedCashCents)}).`);
      sessionId = session.id;
      statements.push(
        d1
          .prepare("INSERT INTO cash_movements (id, tenant_id, session_id, type, amount_cents, reason, user_id, user_name, created_at) VALUES (?1, ?2, ?3, 'out', ?4, ?5, ?6, ?7, ?8)")
          .bind(newId(), t.id, session.id, input.amountCents, `Pago a ${r.supplier_name} · ${label}`, user.id, user.name, now),
      );
    }
    statements.push(
      d1
        .prepare("UPDATE purchase_receipts SET paid_cents = CASE WHEN paid_cents + ?1 <= amount_due_cents THEN paid_cents + ?1 END WHERE id = ?2 AND tenant_id = ?3")
        .bind(input.amountCents, r.id, t.id),
      d1
        .prepare(
          `INSERT INTO supplier_payments (id, tenant_id, supplier_id, receipt_id, amount_cents, method, reference, paid_on, note, session_id, user_id, user_name, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        )
        .bind(id, t.id, r.supplier_id, r.id, input.amountCents, input.method, input.reference, input.paidOn, input.note, sessionId, user.id, user.name, now),
      toStatement(d1, auditEntry(c, { action: "payable.pay", entity: "purchase_receipt", entityId: r.id, after: { amountCents: input.amountCents, method: input.method, supplier: r.supplier_name, fromCashDrawer: input.fromCashDrawer } })),
    );
    try {
      await d1.batch(statements);
    } catch (err) {
      if (/NOT NULL constraint failed: purchase_receipts\.paid_cents/.test(String((err as Error).message))) {
        throw new AppError(409, "overpaid", "Otro pago a esta factura se registró al mismo tiempo. Recarga para ver el saldo.");
      }
      throw err;
    }
    return c.json({ id, balanceCents: balance - input.amountCents }, 201);
  });
