import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Store, Truck } from "lucide-react";
import { formatQty, LOW_STOCK_BADGE, type StoreProduct } from "@nexo/shared";
import { Button, useToast } from "@nexo/ui";
import { api, imageUrl, RequestError } from "../lib/api";
import { stepFor, useStore } from "../lib/store";
import { Qty } from "../components/Qty";

export function ProductPage() {
  const { id } = useParams();
  const { slug, store, money, add, setCartOpen, cart } = useStore();
  const toast = useToast();
  const [p, setP] = useState<StoreProduct | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [image, setImage] = useState(0);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    setP(null);
    setError(null);
    setImage(0);
    api<StoreProduct>("GET", `/${slug}/products/${id}`).then(
      (prod) => {
        setP(prod);
        // Start on the first variant that is in stock.
        const first = prod.variants.find((v) => v.available === null || v.available > 0) ?? prod.variants[0]!;
        setSelected(first.options);
        setQty(stepFor(prod.unit));
        document.title = `${prod.name} · ${store?.name ?? ""}`;
      },
      (e: RequestError) => setError(e),
    );
  }, [slug, id, store?.name]);

  const variant = useMemo(() => p?.variants.find((v) => v.options.every((o, i) => o === selected[i])) ?? null, [p, selected]);
  if (error) {
    return (
      <div className="st-wrap st-empty">
        <h1 className="st-empty__title">Producto no disponible</h1>
        <p className="st-empty__text">{error.message}</p>
        <Link className="nx-btn nx-btn--secondary" to={`/${slug}`}>Ver la tienda</Link>
      </div>
    );
  }
  if (!p || !store) return <div className="st-wrap st-product"><div className="st-skeleton" style={{ aspectRatio: "1" }} /><div><div className="st-skeleton" style={{ height: 40, width: "70%" }} /></div></div>;

  const inCart = variant ? (cart.find((l) => l.variantId === variant.id)?.quantity ?? 0) : 0;
  const left = variant?.available === null || variant === null ? null : Math.max(variant.available - inCart, 0);
  const soldOut = variant !== null && variant.available !== null && variant.available <= 0;
  const valuesFor = (index: number) => [...new Set(p.variants.map((v) => v.options[index]!))];
  /** A value is unavailable when no in-stock variant has it together with the other selected options. */
  const availableWith = (index: number, value: string) =>
    p.variants.some((v) => v.options[index] === value && v.options.every((o, i) => i === index || o === selected[i]) && (v.available === null || v.available > 0));
  const images = p.images.length ? p.images : [];

  const onAdd = () => {
    if (!variant) return;
    add({
      variantId: variant.id, productId: p.id, name: p.name, options: variant.options, image: p.images[0] ?? null, unit: p.unit,
      priceCents: variant.priceCents, taxRateBps: p.taxRateBps, displayPriceCents: variant.displayPriceCents, available: variant.available, quantity: qty,
    });
    toast(`${p.name} se agregó al carrito`);
    setCartOpen(true);
  };

  return (
    <div className="st-wrap">
      <div className="st-product">
        <div className="st-gallery">
          <div className="st-gallery__main">
            {images[image] ? <img src={imageUrl(images[image])!} alt={p.name} /> : <div className="st-card__placeholder" style={{ fontSize: 72 }} aria-hidden="true">{p.name.slice(0, 1)}</div>}
          </div>
          {images.length > 1 && (
            <div className="st-gallery__thumbs">
              {images.map((key, i) => (
                <button type="button" key={key} className="st-gallery__thumb" aria-current={i === image} aria-label={`Imagen ${i + 1} de ${images.length}`} onClick={() => setImage(i)}>
                  <img src={imageUrl(key)!} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <nav className="st-crumbs" aria-label="Ruta">
            <Link to={`/${slug}`}>Inicio</Link>
            {p.categoryName && <><span aria-hidden="true">/</span><Link to={`/${slug}?categoria=${p.categoryId}`}>{p.categoryName}</Link></>}
          </nav>
          <h1 className="st-product__title">{p.name}</h1>
          {p.brandName && <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 8 }}>{p.brandName}</div>}
          <div className="st-product__price">
            {variant ? money(variant.displayPriceCents) : "—"}
            {p.unit !== "unit" && p.unit !== "service" && <span className="st-product__tax">por {formatQty(1, p.unit).replace(/^1\s*/, "")}</span>}
            <span className="st-product__tax">IVA incluido</span>
          </div>
          {p.optionNames.map((name, index) => (
            <div className="st-option" key={name}>
              <div className="st-option__label">{name}: <strong>{selected[index]}</strong></div>
              <div className="st-option__values" role="group" aria-label={name}>
                {valuesFor(index).map((value) => {
                  const ok = availableWith(index, value);
                  return (
                    <button
                      type="button"
                      key={value}
                      className="st-option__value"
                      aria-pressed={selected[index] === value}
                      data-unavailable={!ok}
                      aria-label={ok ? value : `${value}, agotado`}
                      onClick={() => {
                        const next = [...selected];
                        next[index] = value;
                        // If that combination does not exist, jump to the closest one that does.
                        if (!p.variants.some((v) => v.options.every((o, i) => o === next[i]))) {
                          const fallback = p.variants.find((v) => v.options[index] === value)!;
                          setSelected(fallback.options);
                        } else setSelected(next);
                        setQty(stepFor(p.unit));
                      }}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="st-buy">
            {!soldOut && <Qty value={qty} onChange={setQty} unit={p.unit} max={left} label="Cantidad" />}
            <Button variant="primary" size="lg" disabled={!variant || soldOut || left === 0} onClick={onAdd}>
              {soldOut ? "Agotado" : left === 0 ? "Ya tienes todas en tu carrito" : `Agregar · ${money(Math.round((variant?.displayPriceCents ?? 0) * qty))}`}
            </Button>
          </div>
          {variant && variant.available !== null && !soldOut && (
            <div className="st-stock" data-tone={variant.available <= LOW_STOCK_BADGE ? "low" : undefined}>
              {variant.available <= LOW_STOCK_BADGE ? `Quedan ${formatQty(variant.available, p.unit)}` : <><Check size={14} aria-hidden="true" />Disponible</>}
            </div>
          )}
          {soldOut && <div className="st-stock" data-tone="out">Esta opción está agotada.</div>}
          {p.description && <p className="st-product__desc">{p.description}</p>}
          <div className="st-perks">
            {store.pickupEnabled && <div><Store size={16} strokeWidth={1.6} aria-hidden="true" /><span>Recógelo en tienda sin costo{store.pickupAddress ? ` · ${store.pickupAddress}` : ""}.</span></div>}
            {store.deliveryEnabled && (
              <div><Truck size={16} strokeWidth={1.6} aria-hidden="true" /><span>Envío a domicilio{store.deliveryArea ? ` en ${store.deliveryArea}` : ""}{store.freeDeliveryFromCents !== null ? `, gratis desde ${money(store.freeDeliveryFromCents)}` : store.deliveryFeeCents ? ` por ${money(store.deliveryFeeCents)}` : ""}.</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
