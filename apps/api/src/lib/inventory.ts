/**
 * THE ONLY place that changes stock.
 *
 * Every stock change is a list of D1 statements that the caller runs in ONE d1.batch()
 * together with whatever caused it (a product creation, a sale, an import...). D1 runs a batch
 * as a single transaction, and each database processes one request at a time, so:
 *   - stock_levels.quantity has CHECK (quantity >= 0): an output larger than the stock fails
 *     and rolls back the WHOLE batch. Overselling is impossible, even with concurrent requests.
 *   - balance_after in the Kardex is read from stock_levels inside the same batch, so it is
 *     always the real balance right after the movement.
 */
import { AppError } from "./errors";
import { newId } from "./crypto";

export interface MovementActor {
  tenantId: string;
  userId: string | null;
  userName: string | null;
}

export type Movement =
  | {
      kind: "initial" | "in";
      variantId: string;
      locationId: string;
      /** Thousandths of the unit, > 0. */
      quantityMilli: number;
      /** Cost of each unit received. Updates the weighted average cost. null → keep the current average. */
      unitCostCents: number | null;
      reason: string;
      note?: string | null;
      reference?: string | null;
      /** Type stored in the Kardex when it is not the kind itself. */
      type?: "return" | "purchase" | "transfer_in" | "order_cancel";
    }
  | {
      kind: "out";
      variantId: string;
      locationId: string;
      quantityMilli: number;
      reason: string;
      note?: string | null;
      reference?: string | null;
      type?: "sale" | "transfer_out" | "order";
    }
  | {
      /** Physical count: sets the stock to an absolute quantity. */
      kind: "adjust";
      variantId: string;
      locationId: string;
      targetMilli: number;
      reason: string;
      note?: string | null;
      reference?: string | null;
    };

const INSERT_MOVEMENT = `
INSERT INTO stock_movements
  (id, tenant_id, variant_id, location_id, type, reason, quantity_delta, balance_after, unit_cost_cents, note, reference, user_id, user_name)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, %DELTA%, %BALANCE%, %COST%, ?8, ?9, ?10, ?11
FROM stock_levels sl JOIN variants v ON v.id = sl.variant_id
WHERE sl.variant_id = ?3 AND sl.location_id = ?4 AND sl.tenant_id = ?2`;

export function movementStatements(d1: D1Database, actor: MovementActor, m: Movement): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const { tenantId } = actor;
  const statements: D1PreparedStatement[] = [
    d1
      .prepare("INSERT INTO stock_levels (tenant_id, variant_id, location_id, quantity) VALUES (?1, ?2, ?3, 0) ON CONFLICT(variant_id, location_id) DO NOTHING")
      .bind(tenantId, m.variantId, m.locationId),
  ];
  const common = (amount: number, cost: number | null) =>
    [newId(), tenantId, m.variantId, m.locationId, ("type" in m && m.type) || m.kind, m.reason, amount, m.note ?? null, m.reference ?? null, actor.userId, actor.userName, cost] as const;

  if (m.kind === "initial" || m.kind === "in") {
    if (!(m.quantityMilli > 0)) throw new AppError(422, "validation_error", "La cantidad debe ser mayor a 0");
    if (m.unitCostCents !== null) {
      // Weighted average over the stock of ALL locations, computed before adding the new units.
      statements.push(
        d1
          .prepare(
            `UPDATE variants SET cost_cents = CAST(ROUND(
               (MAX((SELECT COALESCE(SUM(quantity), 0) FROM stock_levels WHERE variant_id = ?1), 0) * cost_cents + ?2 * ?3) * 1.0
               / (MAX((SELECT COALESCE(SUM(quantity), 0) FROM stock_levels WHERE variant_id = ?1), 0) + ?2)
             ) AS INTEGER)
             WHERE id = ?1 AND tenant_id = ?4`,
          )
          .bind(m.variantId, m.quantityMilli, m.unitCostCents, tenantId),
      );
    }
    statements.push(
      d1
        .prepare("UPDATE stock_levels SET quantity = quantity + ?1, updated_at = ?2 WHERE variant_id = ?3 AND location_id = ?4 AND tenant_id = ?5")
        .bind(m.quantityMilli, now, m.variantId, m.locationId, tenantId),
      d1
        .prepare(INSERT_MOVEMENT.replace("%DELTA%", "?7").replace("%BALANCE%", "sl.quantity").replace("%COST%", "COALESCE(?12, v.cost_cents)"))
        .bind(...common(m.quantityMilli, m.unitCostCents)),
    );
    return statements;
  }

  if (m.kind === "out") {
    if (!(m.quantityMilli > 0)) throw new AppError(422, "validation_error", "La cantidad debe ser mayor a 0");
    statements.push(
      // Fails with "CHECK constraint failed" if there is not enough stock → the batch rolls back.
      d1
        .prepare("UPDATE stock_levels SET quantity = quantity - ?1, updated_at = ?2 WHERE variant_id = ?3 AND location_id = ?4 AND tenant_id = ?5")
        .bind(m.quantityMilli, now, m.variantId, m.locationId, tenantId),
      d1
        .prepare(INSERT_MOVEMENT.replace("%DELTA%", "-?7").replace("%BALANCE%", "sl.quantity").replace("%COST%", "COALESCE(?12, v.cost_cents)"))
        .bind(...common(m.quantityMilli, null)),
    );
    return statements;
  }

  if (m.kind !== "adjust") throw new Error("unreachable");
  // adjust: record the difference first (needs the stock before the change), then set it.
  if (!(m.targetMilli >= 0)) throw new AppError(422, "validation_error", "La cantidad no puede ser negativa");
  statements.push(
    d1
      .prepare(INSERT_MOVEMENT.replace("%DELTA%", "?7 - sl.quantity").replace("%BALANCE%", "?7").replace("%COST%", "COALESCE(?12, v.cost_cents)"))
      .bind(...common(m.targetMilli, null)),
    d1
      .prepare("UPDATE stock_levels SET quantity = ?1, updated_at = ?2 WHERE variant_id = ?3 AND location_id = ?4 AND tenant_id = ?5")
      .bind(m.targetMilli, now, m.variantId, m.locationId, tenantId),
  );
  return statements;
}

/**
 * Applies a physical count in a few set-based statements (a count can have thousands of lines).
 * For every counted line: delta = counted − stock when it was counted; the new stock is
 * current + delta (never below 0). Lines without a difference write no Kardex entry.
 * Must run in the same batch as the count's status transition.
 */
export function countAdjustmentStatements(d1: D1Database, actor: MovementActor, countId: string, locationId: string, note: string): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const { tenantId } = actor;
  const counted = "count_id = ?1 AND tenant_id = ?2 AND counted_quantity IS NOT NULL";
  return [
    d1
      .prepare(`INSERT INTO stock_levels (tenant_id, variant_id, location_id, quantity) SELECT ?2, variant_id, ?3, 0 FROM stock_count_items WHERE ${counted} ON CONFLICT(variant_id, location_id) DO NOTHING`)
      .bind(countId, tenantId, locationId),
    // Stock right before the adjustment and the resulting difference.
    d1
      .prepare(
        `UPDATE stock_count_items SET
           final_before = (SELECT quantity FROM stock_levels sl WHERE sl.variant_id = stock_count_items.variant_id AND sl.location_id = ?3),
           unit_cost_cents = (SELECT cost_cents FROM variants v WHERE v.id = stock_count_items.variant_id)
         WHERE ${counted}`,
      )
      .bind(countId, tenantId, locationId),
    d1
      .prepare(`UPDATE stock_count_items SET final_delta = MAX(final_before + counted_quantity - COALESCE(stock_at_count, final_before), 0) - final_before WHERE ${counted}`)
      .bind(countId, tenantId),
    d1
      .prepare(
        `INSERT INTO stock_movements (id, tenant_id, variant_id, location_id, type, reason, quantity_delta, balance_after, unit_cost_cents, note, reference, user_id, user_name, created_at)
         SELECT lower(hex(randomblob(13))), ?2, variant_id, ?3, 'adjust', 'stock_count', final_delta, final_before + final_delta, unit_cost_cents, ?4, ?1, ?5, ?6, ?7
         FROM stock_count_items WHERE ${counted} AND final_delta <> 0 ORDER BY name COLLATE NOCASE`,
      )
      .bind(countId, tenantId, locationId, note, actor.userId, actor.userName, now),
    d1
      .prepare(
        `UPDATE stock_levels SET
           quantity = quantity + (SELECT final_delta FROM stock_count_items i WHERE i.count_id = ?1 AND i.variant_id = stock_levels.variant_id),
           updated_at = ?4
         WHERE tenant_id = ?2 AND location_id = ?3
           AND variant_id IN (SELECT variant_id FROM stock_count_items WHERE ${counted} AND final_delta <> 0)`,
      )
      .bind(countId, tenantId, locationId, now),
  ];
}

/**
 * State-machine guard for documents (orders, transfers, counts). Put it in the same batch as
 * the change: if the row is no longer in one of `from`, the CASE yields NULL, the NOT NULL
 * constraint on status fails and the whole batch rolls back. Extra SET columns go in `set`.
 */
export function transitionStatement(
  d1: D1Database,
  table: "purchase_orders" | "transfers" | "stock_counts" | "orders",
  where: { id: string; tenantId: string },
  from: readonly string[],
  to: string,
  set: Record<string, string | number | null> = {},
): D1PreparedStatement {
  const cols = Object.keys(set);
  const fromList = from.map((_, i) => `?${i + 4}`).join(", ");
  const extra = cols.map((col, i) => `, ${col} = ?${from.length + 4 + i}`).join("");
  return d1
    .prepare(`UPDATE ${table} SET status = CASE WHEN status IN (${fromList}) THEN ?3 END${extra} WHERE id = ?1 AND tenant_id = ?2`)
    .bind(where.id, where.tenantId, to, ...from, ...cols.map((c) => set[c]!));
}
export const isTransitionError = (err: unknown) => /NOT NULL constraint failed: \w+\.status/i.test(String((err as Error)?.message ?? err));

/** True for the CHECK constraint with this name (e.g. "purchase_order_items_received_le_qty"). */
export const isCheckError = (err: unknown, name: string) => String((err as Error)?.message ?? err).includes("CHECK constraint failed") && String((err as Error)?.message ?? err).includes(name);

export const isStockCheckError = (err: unknown) => /CHECK constraint failed/i.test(String((err as Error)?.message ?? err));
export const isUniqueError = (err: unknown) => /UNIQUE constraint failed/i.test(String((err as Error)?.message ?? err));

/** Runs a drizzle query builder as a raw D1 statement, so it can share a d1.batch() with raw SQL. */
export function toStatement(d1: D1Database, query: { toSQL(): { sql: string; params: unknown[] } }): D1PreparedStatement {
  const { sql, params } = query.toSQL();
  return d1.prepare(sql).bind(...params);
}

/** Splits a list so IN (...) queries stay under D1's 100 bound parameters per statement. */
export function chunk<T>(items: T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
