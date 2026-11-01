import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@nexo/ui";
import { imageUrl } from "../lib/api";
import { useStore } from "../lib/store";
import { Qty } from "./Qty";

export function CartDrawer() {
  const { cart, cartOpen, setCartOpen, setQuantity, remove, money, totals, slug, store, linePrice } = useStore();
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cartOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCartOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [cartOpen, setCartOpen]);
  if (!cartOpen) return null;
  const t = totals("pickup");
  const below = store && t.itemsCents < store.minOrderCents;

  return (
    <>
      <div className="st-drawer-scrim" onClick={() => setCartOpen(false)} aria-hidden="true" />
      <div className="st-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" ref={panel} tabIndex={-1}>
        <div className="st-drawer__head">
          <h2 className="st-drawer__title" id="cart-title">Tu carrito</h2>
          <Button variant="ghost" icon aria-label="Cerrar carrito" onClick={() => setCartOpen(false)}><X className="nx-icon" aria-hidden="true" /></Button>
        </div>
        {cart.length === 0 ? (
          <div className="st-drawer__body" style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
            <div>
              <p style={{ margin: "0 0 16px", color: "var(--ink-muted)" }}>Tu carrito está vacío.</p>
              <Button onClick={() => { setCartOpen(false); navigate(`/${slug}`); }}>Ver productos</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="st-drawer__body">
              {cart.map((l) => (
                <div className="st-line" key={l.variantId}>
                  <Link to={`/${slug}/p/${l.productId}`} className="st-line__img" onClick={() => setCartOpen(false)} tabIndex={-1} aria-hidden="true">
                    {l.image && <img src={imageUrl(l.image)!} alt="" />}
                  </Link>
                  <div>
                    <div className="st-line__name">{l.name}</div>
                    {l.options.length > 0 && <div className="st-line__opts">{l.options.join(" / ")}</div>}
                    <div className="st-line__controls">
                      <Qty size="sm" value={l.quantity} unit={l.unit} max={l.available} onChange={(v) => setQuantity(l.variantId, v)} label={`Cantidad de ${l.name}`} />
                      <button type="button" className="st-line__remove" onClick={() => remove(l.variantId)}>Quitar</button>
                    </div>
                  </div>
                  <div className="st-line__price">
                    {money(Math.round(linePrice(l) * l.quantity))}
                    {linePrice(l) !== l.displayPriceCents && <s className="st-price-was" style={{ display: "block", fontSize: 12 }}>{money(Math.round(l.displayPriceCents * l.quantity))}</s>}
                  </div>
                </div>
              ))}
            </div>
            <div className="st-drawer__foot">
              <dl className="st-sum" style={{ margin: 0 }}>
                <div className="st-sum__total" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}><dt>Subtotal</dt><dd>{money(t.itemsCents)}</dd></div>
              </dl>
              <span className="nx-help">Impuestos incluidos. El envío se calcula al pagar.</span>
              {below && <span className="nx-help" style={{ color: "var(--warning)" }}>El pedido mínimo es de {money(store.minOrderCents)}.</span>}
              <Button variant="primary" size="lg" block disabled={Boolean(below)} onClick={() => { setCartOpen(false); navigate(`/${slug}/pagar`); }}>Continuar con el pedido</Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
