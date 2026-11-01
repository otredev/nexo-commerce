import { Link } from "react-router-dom";
import type { StoreProductCard } from "@nexo/shared";
import { Badge } from "@nexo/ui";
import { imageUrl } from "../lib/api";
import { useStore } from "../lib/store";

export function ProductCard({ p }: { p: StoreProductCard }) {
  const { slug, money } = useStore();
  return (
    <Link to={`/${slug}/p/${p.id}`} className="st-card" data-soldout={p.soldOut}>
      <div className="st-card__media">
        {p.image ? <img src={imageUrl(p.image)!} alt="" loading="lazy" /> : <div className="st-card__placeholder" aria-hidden="true">{p.name.slice(0, 1)}</div>}
        {p.soldOut ? <span className="st-card__badge"><Badge>Agotado</Badge></span> : p.lowStock ? <span className="st-card__badge"><Badge tone="warning">Últimas piezas</Badge></span> : null}
      </div>
      <div className="st-card__body">
        <h3 className="st-card__name">{p.name}</h3>
        <div className="st-card__price">{p.priceVaries ? "Desde " : ""}{money(p.fromPriceCents)}</div>
      </div>
    </Link>
  );
}
