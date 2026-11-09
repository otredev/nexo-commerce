/**
 * Home of the store: the sections arranged in Apariencia › Página principal, top to bottom.
 * A search or a filter (?q=, ?categoria=, ?palabra=) shows the catalog alone.
 */
import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { HomeBlocks } from "../components/Blocks";
import { CatalogSection, DEFAULT_CATALOG } from "../components/CatalogSection";

export function CatalogPage() {
  const { store } = useStore();
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const q = params.get("q") ?? "";
  const filtered = Boolean(q || params.get("categoria") || params.get("palabra"));

  // Links to a section (#horarios) from the menu or a button.
  useEffect(() => {
    if (!hash || !store) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => clearTimeout(t);
  }, [hash, store]);

  if (!store) return null;
  const catalog = store.appearance.blocks.find((b) => b.type === "catalog");

  if (filtered) {
    return (
      <div className="st-wrap">
        {q ? (
          <section className="st-hero" style={{ paddingBottom: 8 }}>
            <h1 className="st-hero__title" style={{ fontSize: 34 }}>Resultados para “{q}”</h1>
            <p className="st-hero__tagline"><button type="button" className="nx-link" style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => setParams({})}>Ver todos los productos</button></p>
          </section>
        ) : (
          <h1 className="nx-sr-only">{store.name}</h1>
        )}
        <div style={{ paddingTop: q ? 0 : 24 }}>
          <CatalogSection data={catalog?.type === "catalog" ? { ...catalog.data, categories: true, keywords: true, heading: null } : DEFAULT_CATALOG} />
        </div>
      </div>
    );
  }
  return <HomeBlocks blocks={store.appearance.blocks.filter((b) => b.type !== "header")} />;
}
