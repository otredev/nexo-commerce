import { Hono } from "hono";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { tenant } from "@nexo/db";
import { cashMovementSchema, closeCashSchema, formatMoney, openCashSchema, type CashSession, type CashSessionTotals } from "@nexo/shared";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { auditEntry } from "../lib/audit";
import { newId } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { isUniqueError, toStatement } from "../lib/inventory";
import { getSettings, sessionTotals } from "../lib/sales";
import { json } from "../lib/validate";
import { requirePermission, allowed } from "../middleware/auth";

const { cashSessions, cashMovements, locations } = tenant;

/** Builds the session view. While open, the expected cash is hidden from the cashier (blind count). */
async function loadSession(c: Context<AppEnv>, id: string, opts: { revealExpected: boolean }): Promise<CashSession | null> {
  const { db, d1, tenant: t } = c.var.auth;
  const s = await db.select().from(cashSessions).where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, t.id))).get();
  if (!s) return null;
  const [location, moves] = await Promise.all([
    db.select({ name: locations.name }).from(locations).where(eq(locations.id, s.locationId)).get(),
    db.select().from(cashMovements).where(eq(cashMovements.sessionId, id)).orderBy(asc(cashMovements.createdAt)),
  ]);
  const totals = s.status === "closed" ? (s.totals as CashSessionTotals | null) : await sessionTotals(d1, t.id, s.id, s.openingCashCents);
  const showExpected = s.status === "closed" || opts.revealExpected;
  return {
    id: s.id,
    locationId: s.locationId,
    locationName: location?.name ?? "—",
    status: s.status,
    openedAt: s.openedAt,
    openedBy: s.openedByName,
    closedAt: s.closedAt,
    closedBy: s.closedByName,
    openingCashCents: s.openingCashCents,
    countedCashCents: s.countedCashCents,
    expectedCashCents: showExpected ? (s.expectedCashCents ?? totals?.expectedCashCents ?? null) : null,
    differenceCents: s.differenceCents,
    note: s.note,
    totals: totals && !showExpected ? { ...totals, expectedCashCents: 0, cashSalesCents: 0, byMethod: { ...totals.byMethod, cash: 0 } } : totals,
    movements: moves.map((m) => ({ id: m.id, type: m.type, amountCents: m.amountCents, reason: m.reason, userName: m.userName, createdAt: m.createdAt })),
  };
}

const canSeeExpected = (c: Context<AppEnv>) => allowed(c.var.auth, "cash:review");

export const cashRoutes = new Hono<AppEnv>()
  /** The open session of a location, or null. */
  .get("/current", requirePermission("cash:operate"), async (c) => {
    const locationId = z.string().min(1).max(40).parse(c.req.query("locationId"));
    const { db, tenant: t } = c.var.auth;
    const s = await db.select({ id: cashSessions.id }).from(cashSessions).where(and(eq(cashSessions.tenantId, t.id), eq(cashSessions.locationId, locationId), eq(cashSessions.status, "open"))).get();
    return c.json(s ? await loadSession(c, s.id, { revealExpected: canSeeExpected(c) }) : null);
  })

  .post("/open", requirePermission("cash:operate"), json(openCashSchema), async (c) => {
    const input = c.req.valid("json");
    const { db, d1, tenant: t, user } = c.var.auth;
    const location = await db.select().from(locations).where(and(eq(locations.id, input.locationId), eq(locations.tenantId, t.id))).get();
    if (!location || !location.active) throw notFound("Ubicación");
    const id = newId();
    try {
      await d1.batch([
        toStatement(d1, db.insert(cashSessions).values({ id, tenantId: t.id, locationId: input.locationId, openingCashCents: input.openingCashCents, openedBy: user.id, openedByName: user.name, note: input.note })),
        toStatement(d1, auditEntry(c, { action: "cash.open", entity: "cash_session", entityId: id, after: { location: location.name, openingCashCents: input.openingCashCents } })),
      ]);
    } catch (err) {
      // The partial unique index allows one open session per location.
      if (isUniqueError(err)) throw new AppError(409, "already_open", "La caja de esta ubicación ya está abierta.");
      throw err;
    }
    return c.json(await loadSession(c, id, { revealExpected: canSeeExpected(c) }), 201);
  })

  .post("/:id/movements", requirePermission("cash:operate"), json(cashMovementSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const { db, d1, tenant: t, user } = c.var.auth;
    const s = await db.select().from(cashSessions).where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, t.id))).get();
    if (!s) throw notFound("Caja");
    if (s.status !== "open") throw new AppError(409, "closed", "Esta caja ya está cerrada");
    if (input.type === "out") {
      const totals = await sessionTotals(d1, t.id, id, s.openingCashCents);
      if (input.amountCents > totals.expectedCashCents) {
        const settings = await getSettings(c);
        throw new AppError(422, "validation_error", "Revisa los campos marcados", { amountCents: `No hay tanto efectivo en caja (${formatMoney(totals.expectedCashCents, settings.currency, settings.locale)})` });
      }
    }
    const moveId = newId();
    await d1.batch([
      toStatement(d1, db.insert(cashMovements).values({ id: moveId, tenantId: t.id, sessionId: id, type: input.type, amountCents: input.amountCents, reason: input.reason, userId: user.id, userName: user.name })),
      toStatement(d1, auditEntry(c, { action: input.type === "in" ? "cash.in" : "cash.out", entity: "cash_session", entityId: id, after: { amountCents: input.amountCents, reason: input.reason } })),
    ]);
    return c.json(await loadSession(c, id, { revealExpected: canSeeExpected(c) }), 201);
  })

  /** Blind close: the cashier counts first; the expected amount and the difference come back only after. */
  .post("/:id/close", requirePermission("cash:operate"), json(closeCashSchema), async (c) => {
    const input = c.req.valid("json");
    const id = c.req.param("id");
    const { db, d1, tenant: t, user } = c.var.auth;
    const s = await db.select().from(cashSessions).where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, t.id))).get();
    if (!s) throw notFound("Caja");
    if (s.status !== "open") throw new AppError(409, "closed", "Esta caja ya está cerrada");
    const totals = await sessionTotals(d1, t.id, id, s.openingCashCents);
    const difference = input.countedCashCents - totals.expectedCashCents;
    await d1.batch([
      d1
        .prepare(
          `UPDATE cash_sessions SET status = 'closed', closed_at = ?1, closed_by = ?2, closed_by_name = ?3, expected_cash_cents = ?4,
             counted_cash_cents = ?5, difference_cents = ?6, totals = ?7, note = COALESCE(?8, note)
           WHERE id = ?9 AND tenant_id = ?10 AND status = 'open'`,
        )
        .bind(new Date().toISOString(), user.id, user.name, totals.expectedCashCents, input.countedCashCents, difference, JSON.stringify(totals), input.note, id, t.id),
      toStatement(d1, auditEntry(c, { action: "cash.close", entity: "cash_session", entityId: id, after: { expectedCashCents: totals.expectedCashCents, countedCashCents: input.countedCashCents, differenceCents: difference } })),
    ]);
    return c.json(await loadSession(c, id, { revealExpected: true }));
  })

  .get("/sessions", requirePermission("cash:operate"), async (c) => {
    const { db, tenant: t } = c.var.auth;
    const locationId = c.req.query("locationId");
    const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
    const pageSize = 25;
    const where = and(eq(cashSessions.tenantId, t.id), ...(locationId ? [eq(cashSessions.locationId, locationId)] : []));
    const rows = await db
      .select({
        id: cashSessions.id, status: cashSessions.status, openedAt: cashSessions.openedAt, openedBy: cashSessions.openedByName, closedAt: cashSessions.closedAt,
        closedBy: cashSessions.closedByName, openingCashCents: cashSessions.openingCashCents, countedCashCents: cashSessions.countedCashCents,
        expectedCashCents: cashSessions.expectedCashCents, differenceCents: cashSessions.differenceCents, totals: cashSessions.totals, locationName: locations.name,
      })
      .from(cashSessions)
      .leftJoin(locations, eq(locations.id, cashSessions.locationId))
      .where(where)
      .orderBy(desc(cashSessions.openedAt))
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize);
    const hide = !canSeeExpected(c);
    return c.json({
      items: rows.slice(0, pageSize).map((r) => {
        const totals = r.totals as CashSessionTotals | null;
        return { ...r, totals: undefined, salesCount: totals?.salesCount ?? null, salesTotalCents: totals?.salesTotalCents ?? null, expectedCashCents: r.status === "open" && hide ? null : r.expectedCashCents };
      }),
      hasMore: rows.length > pageSize,
      page,
    });
  })

  .get("/sessions/:id", requirePermission("cash:operate"), async (c) => {
    const s = await loadSession(c, c.req.param("id"), { revealExpected: canSeeExpected(c) });
    if (!s) throw notFound("Caja");
    return c.json(s);
  });
