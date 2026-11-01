import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { ALL_REASONS, formatQty, MOVEMENT_TYPE_LABELS, type StockMovement } from "@nexo/shared";
import { Alert, Button, EmptyState } from "@nexo/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";

const timeFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

/** Kardex table with "load more" pagination. `query` is the filter string for /inventory/movements. */
export function MovementsTable({ query, showProduct = true, refreshKey = 0 }: { query: string; showProduct?: boolean; refreshKey?: number }) {
  const { can } = useAuth();
  const { money } = useBusiness();
  const showCost = can("costs:read");
  const [items, setItems] = useState<StockMovement[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (after: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await get<{ items: StockMovement[]; nextCursor: string | null }>(`/inventory/movements?limit=50${query ? `&${query}` : ""}${after ? `&cursor=${after}` : ""}`);
      setItems((all) => (after ? [...all, ...res.items] : res.items));
      setCursor(res.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, refreshKey]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  return (
    <div className="nx-table-wrap">
      {!loading && items.length === 0 ? (
        <EmptyState icon={<History className="nx-icon" />} title="Sin movimientos" text="Aquí aparecerá cada entrada, salida y ajuste de inventario." />
      ) : (
        <div className="nx-table-scroll" aria-busy={loading}>
          <table className="nx-table">
            <thead>
              <tr>
                <th>Fecha</th>
                {showProduct && <th>Producto</th>}
                <th>Movimiento</th>
                <th>Ubicación</th>
                <th className="nx-col-num">Cantidad</th>
                <th className="nx-col-num">Saldo</th>
                {showCost && <th className="nx-col-num">Costo unit.</th>}
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{timeFmt.format(new Date(m.createdAt))}</td>
                  {showProduct && (
                    <td>
                      <div>{m.productName}{m.options.length > 0 && <span className="nx-muted"> · {m.options.join(" / ")}</span>}</div>
                      <div className="nx-mono nx-muted">{m.sku}</div>
                    </td>
                  )}
                  <td>
                    <div>{MOVEMENT_TYPE_LABELS[m.type]}</div>
                    <div className="nx-muted" style={{ fontSize: 12 }}>{ALL_REASONS[m.reason] ?? m.reason}{m.note && ` — ${m.note}`}</div>
                  </td>
                  <td className="nx-muted">{m.locationName}</td>
                  <td className={`nx-col-num ${m.quantity > 0 ? "nx-qty-in" : m.quantity < 0 ? "nx-qty-out" : ""}`}>{m.quantity > 0 ? "+" : ""}{formatQty(m.quantity, m.unit)}</td>
                  <td className="nx-col-num">{formatQty(m.balanceAfter, m.unit)}</td>
                  {showCost && <td className="nx-col-num nx-muted">{money(m.unitCostCents)}</td>}
                  <td className="nx-muted">{m.userName ?? "Sistema"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <div className="nx-table-footer">
          <span>{items.length} movimientos</span>
          <Button size="sm" loading={loading} onClick={() => void load(cursor)}>Cargar más</Button>
        </div>
      )}
    </div>
  );
}
