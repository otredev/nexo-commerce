/**
 * The store's catalog: category and keyword chips, sort and the product grid. Drawn by the "Catálogo"
 * section of the home and, alone, for searches and filters (?q=, ?categoria=, ?palabra=).
 */
import { useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { newBlock, PRODUCT_SORTS, type BlockData, type Paginated, type ProductSort, type StoreProductCard } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { api, RequestError } from "../lib/api";
import { useStore } from "../lib/store";
import { ProductCard } from "./ProductCard";

export const DEFAULT_CATALOG = newBlock("catalog", "catalogo").data;

export function CatalogSection({ data: d }: { data: BlockData<"catalog"> }) {
  const { slug, store } = useStore();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("categoria") ?? "";
  const keyword = params.get("palabra") ?? "";
  const sortParam = params.get("orden") as ProductSort | null;
  const sort: ProductSort = sortParam && sortParam in PRODUCT_SORTS ? sortParam : d.defaultSort;
  const [items, setItems] = useState<StoreProductCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (p: number) => {
    const search = new URLSearchParams({ page: String(p), pageSize: String(d.pageSize), sort, ...(q && { q }), ...(category && { categoryId: category }), ...(keyword && { keyword }) });
    const res = await api<Paginated<StoreProductCard>>("GET", `/${slug}/products?${search}`);
    setTotal(res.total);
    setPage(p);
    setItems((prev) => (p === 1 ? res.items : [...(prev ?? []), ...res.items]));
  };
  useEffect(() => {
    setItems(null);
    setError(null);
    load(1).catch((e: RequestError) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, q, category, keyword, sort, d.pageSize]);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  if (!store) return null;
  const mains = store.categories.filter((c) => !c.parentId);
  const chosen = store.categories.find((c) => c.id === category);
  const openCat = mains.find((c) => c.id === (chosen?.parentId ?? chosen?.id));
  const subs = openCat ? store.categories.filter((c) => c.parentId === openCat.id) : [];
  const filtered = Boolean(q || category || keyword);
  const showToolbar = d.categories || d.keywords || d.sort;

  return (
    <div id="productos" className="st-catalog">
      {d.heading && !q && <h2 className="st-block__title">{d.heading}</h2>}
      {showToolbar && (
        <div className="st-toolbar">
          <div className="st-filters">
            {d.categories && mains.length > 0 && (
              <div className="st-chips" role="group" aria-label="Categorías">
                <button type="button" className="st-chip" aria-pressed={!category} onClick={() => set("categoria", "")}>Todo</button>
                {mains.map((c) => (
                  <button type="button" key={c.id} className="st-chip" aria-pressed={openCat?.id === c.id} onClick={() => set("categoria", c.id)}>{c.name}</button>
                ))}
              </div>
            )}
            {d.categories && openCat && subs.length > 0 && (
              <div className="st-chips st-chips--sub" role="group" aria-label={`Subcategorías de ${openCat.name}`}>
                <button type="button" className="st-chip" aria-pressed={category === openCat.id} onClick={() => set("categoria", openCat.id)}>Todo {openCat.name}</button>
                {subs.map((c) => (
                  <button type="button" key={c.id} className="st-chip" aria-pressed={category === c.id} onClick={() => set("categoria", c.id)}>{c.name}</button>
                ))}
              </div>
            )}
            {d.keywords && (store.keywords.length > 0 || keyword) && (
              <div className="st-chips st-chips--tags" role="group" aria-label="Palabras clave">
                {keyword && !store.keywords.some((k) => k.keyword === keyword) && (
                  <button type="button" className="st-chip st-chip--tag" aria-pressed onClick={() => set("palabra", "")}>#{keyword}</button>
                )}
                {store.keywords.map((k) => (
                  <button type="button" key={k.keyword} className="st-chip st-chip--tag" aria-pressed={keyword === k.keyword} onClick={() => set("palabra", keyword === k.keyword ? "" : k.keyword)}>#{k.keyword}</button>
                ))}
              </div>
            )}
          </div>
          {d.sort && (
            <select className="nx-select st-sort" aria-label="Ordenar" value={sort} onChange={(e) => set("orden", e.target.value === d.defaultSort ? "" : e.target.value)} style={{ width: "auto" }}>
              {(Object.keys(PRODUCT_SORTS) as ProductSort[]).map((k) => <option key={k} value={k}>{PRODUCT_SORTS[k]}</option>)}
            </select>
          )}
        </div>
      )}
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {items === null && !error ? (
        <div className="st-grid st-grid--cols" style={{ "--cols": d.columns } as CSSProperties} aria-busy="true" aria-label="Cargando productos">
          {Array.from({ length: Math.min(8, d.pageSize) }, (_, i) => <div key={i}><div className="st-skeleton" style={{ aspectRatio: "4 / 5" }} /><div className="st-skeleton" style={{ height: 14, width: "70%", marginTop: 14 }} /></div>)}
        </div>
      ) : items && items.length === 0 ? (
        <div className="st-empty">
          <h2 className="st-empty__title">{filtered ? "No encontramos productos" : "Muy pronto"}</h2>
          <p className="st-empty__text">{filtered ? "Prueba con otra búsqueda, categoría o palabra clave." : "Estamos preparando el catálogo. Vuelve pronto."}</p>
          {filtered && <Button onClick={() => setParams({})}>Ver todo</Button>}
        </div>
      ) : (
        <>
          <div className="st-grid st-grid--cols" style={{ "--cols": d.columns } as CSSProperties}>{items?.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          {items && items.length < total && (
            <div className="st-more">
              <Button loading={loadingMore} onClick={() => { setLoadingMore(true); load(page + 1).catch(() => {}).finally(() => setLoadingMore(false)); }}>Ver más productos</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
