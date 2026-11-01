import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Package, Plus, Upload } from "lucide-react";
import { formatQty, type Named, type Paginated, type ProductListItem } from "@nexo/shared";
import { Alert, Button, EmptyState, PageHeader, Pagination, SearchInput, Segmented, Tabs, useDebounced } from "@nexo/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";
import { useLoad } from "../lib/hooks";
import { StockBadge, Thumb } from "../components/StockBadge";
import { ImportProductsModal } from "../components/ImportProducts";

type StockFilter = "all" | "low" | "out";

export function ProductsPage() {
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [importing, setImporting] = useState(false);
  const query = useDebounced(q);
  const status = (params.get("estado") === "archivados" ? "archived" : "active") as "active" | "archived";
  const stock = (params.get("stock") ?? "all") as StockFilter;
  const categoryId = params.get("categoria") ?? "";
  const brandId = params.get("marca") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: true });
  };

  const names = useLoad(async () => {
    const [categories, brands] = await Promise.all([get<Named[]>("/categories"), get<Named[]>("/brands")]);
    return { categories, brands };
  });
  const search = new URLSearchParams({ status, stock, page: String(page), pageSize: "25", ...(query && { q: query }), ...(categoryId && { categoryId }), ...(brandId && { brandId }) });
  const { data, error, loading, reload } = useLoad(() => get<Paginated<ProductListItem>>(`/products?${search}`), [search.toString()]);
  const canWrite = can("catalog:write");
  const showValue = can("costs:read");
  const filtered = Boolean(query || categoryId || brandId || stock !== "all");

  return (
    <>
      <PageHeader
        title="Productos"
        description={data ? `${data.total} ${data.total === 1 ? "producto" : "productos"}${filtered ? " con estos filtros" : ""}.` : "Tu catálogo."}
        actions={canWrite && (
          <>
            <Button onClick={() => setImporting(true)}><Upload className="nx-icon" aria-hidden="true" />Importar CSV</Button>
            <Button variant="primary" onClick={() => navigate("/productos/nuevo")}><Plus className="nx-icon" aria-hidden="true" />Nuevo producto</Button>
          </>
        )}
      />
      <Tabs label="Estado" tabs={[{ id: "active", label: "Activos" }, { id: "archived", label: "Archivados" }]} value={status} onChange={(id) => set("estado", id === "archived" ? "archivados" : "")} />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <SearchInput label="Buscar productos" placeholder="Nombre, SKU o código de barras" value={q} onChange={(v) => { setQ(v); set("q", v); }} />
          <div className="nx-filters">
            <select className="nx-select" aria-label="Categoría" value={categoryId} onChange={(e) => set("categoria", e.target.value)}>
              <option value="">Todas las categorías</option>
              {names.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="nx-select" aria-label="Marca" value={brandId} onChange={(e) => set("marca", e.target.value)}>
              <option value="">Todas las marcas</option>
              {names.data?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Segmented label="Existencias" value={stock} onChange={(v) => set("stock", v === "all" ? "" : v)} options={[{ id: "all", label: "Todos" }, { id: "low", label: "Stock bajo" }, { id: "out", label: "Agotados" }]} />
          </div>
        </div>
        {data && data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={<Package className="nx-icon" />} title="No encontramos productos con estos filtros" actions={<Button variant="ghost" onClick={() => { setQ(""); setParams({}); }}>Limpiar filtros</Button>} />
          ) : status === "archived" ? (
            <EmptyState icon={<Package className="nx-icon" />} title="No hay productos archivados" text="Archiva un producto para ocultarlo del punto de venta sin perder su historial." />
          ) : (
            <EmptyState
              icon={<Package className="nx-icon" />}
              title="Aún no tienes productos"
              text="Agrega tu primer producto o importa tu catálogo desde un archivo CSV."
              actions={canWrite && <><Button onClick={() => setImporting(true)}>Importar CSV</Button><Button variant="primary" onClick={() => navigate("/productos/nuevo")}><Plus className="nx-icon" aria-hidden="true" />Nuevo producto</Button></>}
            />
          )
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Producto</th><th>Categoría</th><th>Estado</th><th className="nx-col-num">Existencias</th><th className="nx-col-num">Precio</th>
                  {showValue && <th className="nx-col-num">Valor</th>}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((p) => (
                  <tr key={p.id} className="nx-clickable" onClick={() => navigate(`/productos/${p.id}`)}>
                    <td>
                      <div className="nx-cell-product">
                        <Thumb image={p.image} alt="" />
                        <div>
                          <Link to={`/productos/${p.id}`} style={{ color: "inherit", textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                          <div className="nx-sub">{p.variantCount > 1 ? `${p.variantCount} variantes` : p.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="nx-muted">{[p.category, p.brand].filter(Boolean).join(" · ") || "—"}</td>
                    <td><StockBadge status={p.stockStatus} /></td>
                    <td className="nx-col-num">{p.trackInventory ? formatQty(p.stock, p.unit) : "—"}</td>
                    <td className="nx-col-num">{p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`}</td>
                    {showValue && <td className="nx-col-num nx-muted">{p.trackInventory ? money(p.inventoryValueCents) : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} noun="productos" onPage={(p) => set("pagina", String(p))} />}
      </div>
      <ImportProductsModal open={importing} onClose={() => setImporting(false)} onDone={() => { void reload(); void names.reload(); }} />
    </>
  );
}
