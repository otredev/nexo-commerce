import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MessageCircle, ShoppingBag } from "lucide-react";
import { whatsappLink } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { imageUrl } from "../lib/api";
import { useStore } from "../lib/store";
import { CartDrawer } from "./CartDrawer";

export function StoreLayout() {
  const { store, error, slug, count, setCartOpen } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => { setQ(params.get("q") ?? ""); }, [params]);

  if (error) {
    return (
      <div className="st-wrap st-empty">
        <h1 className="st-empty__title">{error.status === 404 ? "Esta tienda no está disponible" : "No pudimos abrir la tienda"}</h1>
        <p className="st-empty__text">{error.status === 404 ? "Revisa la dirección o vuelve más tarde." : error.message}</p>
        {error.status !== 404 && <Button onClick={() => window.location.reload()}>Intentar de nuevo</Button>}
      </div>
    );
  }
  if (!store) return <div className="nx-page-loading" style={{ minHeight: "60vh" }}><span className="nx-spinner" aria-label="Cargando" /></div>;
  const whatsapp = store.whatsapp ? whatsappLink(store.whatsapp) : null;
  const checkout = location.pathname.endsWith("/pagar");

  return (
    <>
      <a className="nx-sr-only" href="#contenido">Ir al contenido</a>
      <header className="st-header">
        <div className="st-wrap st-header__row">
          <Link to={`/${slug}`} className="st-brand" aria-label={`${store.name}, inicio`}>
            {store.logo && <img src={imageUrl(store.logo)!} alt="" />}
            <span className="st-brand__name">{store.name}</span>
          </Link>
          {!checkout && (
            <form className="st-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/${slug}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); }}>
              <div className="nx-input-group">
                <svg className="nx-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input className="nx-input" type="search" placeholder="Buscar productos" aria-label="Buscar productos" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </form>
          )}
          {!checkout && (
            <button type="button" className="st-cart-btn" onClick={() => setCartOpen(true)} aria-label={`Carrito, ${count} ${count === 1 ? "producto" : "productos"}`}>
              <ShoppingBag size={17} strokeWidth={1.6} aria-hidden="true" />
              <span className="st-cart-btn__label">Carrito</span>
              {count > 0 && <span className="st-cart-btn__count">{count}</span>}
            </button>
          )}
        </div>
      </header>
      <main id="contenido">
        <Outlet />
      </main>
      <footer className="st-footer">
        <div className="st-wrap">
          <div className="st-footer__row">
            <div>
              <div className="st-footer__brand">{store.name}</div>
              {store.address && <div>{store.address}</div>}
            </div>
            <div className="st-footer__links">
              {store.phone && <a href={`tel:${store.phone}`}>Tel. {store.phone}</a>}
              {store.email && <a href={`mailto:${store.email}`}>{store.email}</a>}
              {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}
            </div>
            <div className="st-footer__links">
              {store.pickupEnabled && <span>Recoge en tienda sin costo</span>}
              {store.deliveryEnabled && <span>Envío a domicilio{store.deliveryArea ? ` · ${store.deliveryArea}` : ""}</span>}
            </div>
          </div>
          <div className="st-powered">Tienda creada con Nexo</div>
        </div>
      </footer>
      {whatsapp && !checkout && (
        <a className="st-wa" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={18} strokeWidth={1.6} aria-hidden="true" /><span className="st-wa__label">¿Dudas? Escríbenos</span></a>
      )}
      <CartDrawer />
    </>
  );
}
