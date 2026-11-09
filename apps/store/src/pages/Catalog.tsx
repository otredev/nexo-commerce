import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Store, Truck } from "lucide-react";
import type { Paginated, StoreProductCard } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { api, RequestError } from "../lib/api";
import { useStore } from "../lib/store";
import { ProductCard } from "../components/ProductCard";
import { BannerCarousel } from "../components/Appearance";

type Sort = "featured" | "new" | "price_asc" | "price_desc" | "name";

export function CatalogPage() {
  const { slug, store, money } = useStore();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("categoria") ?? "";
  const keyword = params.get("palabra") ?? "";
  const sort = (params.get("orden") ?? "featured") as Sort;
  const [items, setItems] = useState<StoreProductCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (p: number) => {
    const search = new URLSearchParams({ page: String(p), sort, ...(q && { q }), ...(category && { categoryId: category }), ...(keyword && { keyword }) });
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
  }, [slug, q, category, keyword, sort]);
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

  return (
    <div className="st-wrap">
      {!filtered && store.appearance.banners.length > 0 && <BannerCarousel />}
      {!q && (
        <section className="st-hero" data-compact={store.appearance.banners.length > 0 || undefined}>
          <h1 className={store.appearance.banners.length > 0 ? "nx-sr-only" : "st-hero__title"}>{store.name}</h1>
          {store.tagline && store.appearance.banners.length === 0 && <p className="st-hero__tagline">{store.tagline}</p>}
          <div className="st-hero__facts">
            {store.pickupEnabled && <span><Store size={15} strokeWidth={1.6} aria-hidden="true" />Recoge en tienda sin costo</span>}
            {store.deliveryEnabled && (
              <span>
                <Truck size={15} strokeWidth={1.6} aria-hidden="true" />
                {store.freeDeliveryFromCents !== null ? `Envío gratis desde ${money(store.freeDeliveryFromCents)}` : store.deliveryFeeCents ? `Envío a domicilio por ${money(store.deliveryFeeCents)}` : "Envío a domicilio sin costo"}
              </span>
            )}
          </div>
        </section>
      )}
      {q && (
        <section className="st-hero" style={{ paddingBottom: 8 }}>
          <h1 className="st-hero__title" style={{ fontSize: 34 }}>Resultados para “{q}”</h1>
          <p className="st-hero__tagline"><button type="button" className="nx-link" style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => set("q", "")}>Ver todos los productos</button></p>
        </section>
      )}
      <div className="st-toolbar">
        <div className="st-filters">
          <div className="st-chips" role="group" aria-label="Categorías">
            <button type="button" className="st-chip" aria-pressed={!category} onClick={() => set("categoria", "")}>Todo</button>
            {mains.map((c) => (
              <button type="button" key={c.id} className="st-chip" aria-pressed={openCat?.id === c.id} onClick={() => set("categoria", c.id)}>{c.name}</button>
            ))}
          </div>
          {openCat && subs.length > 0 && (
            <div className="st-chips st-chips--sub" role="group" aria-label={`Subcategorías de ${openCat.name}`}>
              <button type="button" className="st-chip" aria-pressed={category === openCat.id} onClick={() => set("categoria", openCat.id)}>Todo {openCat.name}</button>
              {subs.map((c) => (
                <button type="button" key={c.id} className="st-chip" aria-pressed={category === c.id} onClick={() => set("categoria", c.id)}>{c.name}</button>
              ))}
            </div>
          )}
          {(store.keywords.length > 0 || keyword) && (
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
        <select className="nx-select st-sort" aria-label="Ordenar" value={sort} onChange={(e) => set("orden", e.target.value === "featured" ? "" : e.target.value)} style={{ width: "auto" }}>
          <option value="featured">Destacados</option>
          <option value="new">Lo más nuevo</option>
          <option value="price_asc">Precio: menor a mayor</option>
          <option value="price_desc">Precio: mayor a menor</option>
          <option value="name">Nombre</option>
        </select>
      </div>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {items === null && !error ? (
        <div className="st-grid" aria-busy="true" aria-label="Cargando productos">
          {Array.from({ length: 8 }, (_, i) => <div key={i}><div className="st-skeleton" style={{ aspectRatio: "4 / 5" }} /><div className="st-skeleton" style={{ height: 14, width: "70%", marginTop: 14 }} /></div>)}
        </div>
      ) : items && items.length === 0 ? (
        <div className="st-empty">
          <h2 className="st-empty__title">{filtered ? "No encontramos productos" : "Muy pronto"}</h2>
          <p className="st-empty__text">{filtered ? "Prueba con otra búsqueda, categoría o palabra clave." : "Estamos preparando el catálogo. Vuelve pronto."}</p>
          {filtered && <Button onClick={() => setParams({})}>Ver todo</Button>}
        </div>
      ) : (
        <>
          <div className="st-grid">{items?.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          {items && items.length < total && (
            <div className="st-more">
              <Button loading={loadingMore} onClick={() => { setLoadingMore(true); load(page + 1).catch(() => {}).finally(() => setLoadingMore(false)); }}>Ver más productos</Button>
            </div>
          )}
        </>
      )}
      {!filtered && store && store.faq.length > 0 && (
        <section className="st-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Preguntas frecuentes</h2>
          {store.faq.map((f, i) => (
            <details key={i}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
