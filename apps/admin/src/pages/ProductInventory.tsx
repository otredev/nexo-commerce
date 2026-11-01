import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { formatQty, type ProductDetail } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";
import { AdjustStockModal, type AdjustTarget } from "../components/AdjustStockModal";
import { MovementsTable } from "../components/MovementsTable";
import { StockBadge } from "../components/StockBadge";

/** Stock of each variant in each location, with the action to register a movement. */
export function ProductInventoryTab({ product, onChanged }: { product: ProductDetail; onChanged: () => void }) {
  const { can } = useAuth();
  const { locations, money } = useBusiness();
  const [target, setTarget] = useState<AdjustTarget | null>(null);
  const active = locations.filter((l) => l.active);
  const showCost = can("costs:read");
  const label = (options: string[]) => (options.length ? `${product.name} · ${options.join(" / ")}` : product.name);

  return (
    <>
      <div className="nx-table-wrap">
        <div className="nx-table-scroll">
          <table className="nx-table">
            <thead>
              <tr>
                <th>Variante</th>
                {active.map((l) => <th key={l.id} className="nx-col-num">{l.name}</th>)}
                <th className="nx-col-num">Total</th>
                <th>Estado</th>
                {showCost && <th className="nx-col-num">Costo promedio</th>}
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {product.variants.map((v) => {
                const byLoc = Object.fromEntries(v.stockByLocation.map((s) => [s.locationId, s.quantity]));
                return (
                  <tr key={v.id}>
                    <td>
                      <div>{v.options.length ? v.options.join(" / ") : product.name}</div>
                      <div className="nx-mono nx-muted">{v.sku}</div>
                    </td>
                    {active.map((l) => <td key={l.id} className="nx-col-num">{formatQty(byLoc[l.id] ?? 0, product.unit)}</td>)}
                    <td className="nx-col-num" style={{ fontWeight: 600 }}>{formatQty(v.stock, product.unit)}</td>
                    <td><StockBadge status={v.stockStatus} /></td>
                    {showCost && <td className="nx-col-num nx-muted">{money(v.costCents)}</td>}
                    <td style={{ textAlign: "right" }}>
                      {can("inventory:write") && (
                        <Button size="sm" variant="ghost" onClick={() => setTarget({ variantId: v.id, label: label(v.options), sku: v.sku, unit: product.unit, stockByLocation: byLoc, costCents: v.costCents })}>
                          <ArrowLeftRight className="nx-icon" aria-hidden="true" />Movimiento
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <AdjustStockModal target={target} onClose={() => setTarget(null)} onDone={onChanged} />
    </>
  );
}

export function ProductMovementsTab({ product }: { product: ProductDetail }) {
  return <MovementsTable query={`productId=${product.id}`} showProduct={product.variants.length > 1} />;
}
