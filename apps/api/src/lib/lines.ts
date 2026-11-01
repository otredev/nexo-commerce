import type { Context } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { tenant } from "@nexo/db";
import { quantityFitsUnit, toMilli, unitInfo } from "@nexo/shared";
import type { AppEnv } from "../env";
import { AppError } from "./errors";
import { chunk } from "./inventory";

const { variants, products } = tenant;

export interface ResolvedLine {
  variantId: string;
  productId: string;
  name: string;
  options: string[];
  sku: string;
  barcode: string | null;
  unit: string;
  costCents: number;
  quantityMilli: number;
  position: number;
}

/**
 * Checks the product lines of a document (purchase, transfer): each variant exists, controls
 * inventory, appears once and its quantity fits its unit. Returns a snapshot for each line.
 */
export async function resolveLines(c: Context<AppEnv>, items: Array<{ variantId: string; quantity: number }>, what: string): Promise<ResolvedLine[]> {
  const { db, tenant: t } = c.var.auth;
  const ids = [...new Set(items.map((i) => i.variantId))];
  if (ids.length !== items.length) throw new AppError(422, "validation_error", `Un producto aparece dos veces en ${what}. Junta las cantidades en una sola línea.`);
  const rows: Array<{ id: string; productId: string; sku: string; barcode: string | null; options: string[]; cost: number; name: string; unit: string; track: boolean }> = [];
  for (const part of chunk(ids)) {
    rows.push(
      ...(await db
        .select({
          id: variants.id, productId: variants.productId, sku: variants.sku, barcode: variants.barcode, options: variants.options, cost: variants.costCents,
          name: products.name, unit: products.unit, track: products.trackInventory,
        })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(and(eq(variants.tenantId, t.id), inArray(variants.id, part), isNull(variants.deletedAt), isNull(products.deletedAt)))),
    );
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return items.map((item, position) => {
    const v = byId.get(item.variantId);
    if (!v) throw new AppError(422, "validation_error", `Un producto de ${what} ya no existe. Quítalo e intenta de nuevo.`, { [`items.${position}`]: "No disponible" });
    if (!v.track) throw new AppError(422, "validation_error", `${v.name} no controla inventario.`, { [`items.${position}`]: "Sin inventario" });
    if (!quantityFitsUnit(item.quantity, v.unit)) {
      throw new AppError(422, "validation_error", `${v.name}: ${unitInfo(v.unit).decimals ? "máximo 3 decimales" : "usa cantidades enteras"}`, { [`items.${position}.quantity`]: "Cantidad no válida" });
    }
    return {
      variantId: v.id, productId: v.productId, name: v.name, options: v.options, sku: v.sku, barcode: v.barcode, unit: v.unit,
      costCents: v.cost, quantityMilli: toMilli(item.quantity), position,
    };
  });
}

export const variantLabel = (l: { name: string; options: string[] }) => (l.options.length ? `${l.name} (${l.options.join(" / ")})` : l.name);
