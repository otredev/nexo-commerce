import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Boxes } from "lucide-react";
import { formatQty, type InventoryRow, type InventorySummary, type CategoryItem, type Named, type Paginated } from "@nexo/shared";
import { CategoryOptions } from "../lib/categories";
import { Alert, Button, EmptyState, PageHeader, Pagination, SearchInput, Segmented, Stat, useDebounced } from "@nexo/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";
import { useLoad } from "../lib/hooks";
import { AdjustStockModal, type AdjustTarget } from "../components/AdjustStockModal";
import { StockBadge, Thumb } from "../components/StockBadge";

export function InventoryPage() {
  const { can } = useAuth();
  const { locations, money } = useBusiness();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [target, setTarget] = useState<AdjustTarget | null>(null);
  const query = useDebounced(q);
  const locationId = params.get("ubicacion") ?? "";
  const stock = (params.get("stock") ?? "all") as "all" | "low" | "out";
  const categoryId = params.get("categoria") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: true });
  };
  const showCost = can("costs:read");
  const search = new URLSearchParams({ stock, page: String(page), pageSize: "50", ...(query && { q: query }), ...(locationId && { locationId }), ...(categoryId && { categoryId }) });
  const { data, error, loading, reload } = useLoad(() => get<Paginated<InventoryRow>>(`/inventory?${search}`), [search.toString()]);
  const summary = useLoad(() => get<InventorySummary>("/inventory/summary"));
  const categories = useLoad(() => get<CategoryItem[]>("/categories"));
  const filtered = Boolean(query || stock !== "all" || categoryId);

  return (
    <>
      <PageHeader
        title="Inventario"
        description="Existencias por producto y ubicación."
        actions={<Button onClick={() => navigate("/inventario/movimientos")}>Ver movimientos</Button>}
      />
      {summary.data && (
        <div className="nx-stat-grid">
          <Stat label="Productos activos" value={summary.data.products} meta={`${summary.data.variants} variantes`} />
          <Stat label="Stock bajo" value={summary.data.lowStock} meta={<button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => set("stock", "low")}>Ver productos</button>} />
          <Stat label="Agotados" value={summary.data.outOfStock} meta={<button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => set("stock", "out")}>Ver productos</button>} />
          {showCost && <Stat label="Valor del inventario" value={money(summary.data.inventoryValueCents)} meta="A costo promedio" />}
        </div>
      )}
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput label="Buscar en inventario" placeholder="Nombre, SKU o código de barras" value={q} onChange={(v) => { setQ(v); set("q", v); }} />
          <div className="nx-filters">
            <select className="nx-select" aria-label="Ubicación" value={locationId} onChange={(e) => set("ubicacion", e.target.value)}>
              <option value="">Todas las ubicaciones</option>
              {locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className="nx-select" aria-label="Categoría" value={categoryId} onChange={(e) => set("categoria", e.target.value)}>
              <option value="">Todas las categorías</option>
              {categories.data && <CategoryOptions list={categories.data} />}
            </select>
            <Segmented label="Existencias" value={stock} onChange={(v) => set("stock", v === "all" ? "" : v)} options={[{ id: "all", label: "Todos" }, { id: "low", label: "Stock bajo" }, { id: "out", label: "Agotados" }]} />
          </div>
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<Boxes className="nx-icon" />}
            title={filtered ? "Nada coincide con estos filtros" : "Aún no hay productos con inventario"}
            text={filtered ? undefined : "Los productos que controlan inventario aparecerán aquí."}
            actions={filtered ? <Button variant="ghost" onClick={() => { setQ(""); setParams({}); }}>Limpiar filtros</Button> : <Button variant="primary" onClick={() => navigate("/productos/nuevo")}>Nuevo producto</Button>}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Producto</th><th>Estado</th><th className="nx-col-num">Mínimo</th>
                  <th className="nx-col-num">{locationId ? "Existencia" : "Existencia total"}</th>
                  {showCost && <><th className="nx-col-num">Costo prom.</th><th className="nx-col-num">Valor</th></>}
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => (
                  <tr key={r.variantId}>
                    <td>
                      <div className="nx-cell-product">
                        <Thumb image={r.image} alt="" />
                        <div>
                          <Link to={`/productos/${r.productId}?tab=inventario`} style={{ color: "inherit", textDecoration: "none" }}>
                            {r.productName}{r.options.length > 0 && <span className="nx-muted"> · {r.options.join(" / ")}</span>}
                          </Link>
                          <div className="nx-sub">{r.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td><StockBadge status={r.stockStatus} /></td>
                    <td className="nx-col-num nx-muted">{r.minStock ? formatQty(r.minStock, r.unit) : "—"}</td>
                    <td className="nx-col-num" style={{ fontWeight: 600 }}>{formatQty(r.quantity, r.unit)}</td>
                    {showCost && <><td className="nx-col-num nx-muted">{money(r.costCents)}</td><td className="nx-col-num">{money(r.valueCents)}</td></>}
                    <td style={{ textAlign: "right" }}>
                      {can("inventory:write") && (
                        <Button size="sm" variant="ghost" onClick={() => setTarget({ variantId: r.variantId, label: r.options.length ? `${r.productName} · ${r.options.join(" / ")}` : r.productName, sku: r.sku, unit: r.unit, costCents: r.costCents, ...(locationId && { stockByLocation: { [locationId]: r.quantity } }) })}>
                          <ArrowLeftRight className="nx-icon" aria-hidden="true" />Movimiento
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="variantes" onPage={(p) => set("pagina", String(p))} />}
      </div>
      <AdjustStockModal target={target} defaultLocationId={locationId || undefined} onClose={() => setTarget(null)} onDone={() => { void reload(); void summary.reload(); }} />
    </>
  );
}
