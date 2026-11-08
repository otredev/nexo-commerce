import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MessageCircle, ShoppingBag, UserRound } from "lucide-react";
import { POLICY_INFO, whatsappLink } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { imageUrl, track } from "../lib/api";
import { useStore } from "../lib/store";
import { firstName, useAccount } from "../lib/account";
import { CartDrawer } from "./CartDrawer";
import { AnnouncementBar, ConsentBanner, useConsent, useThemeStyle } from "./Appearance";

export function StoreLayout() {
  const { store, error, slug, link, count, setCartOpen } = useStore();
  const { account, ready } = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  // Traffic: one event per page the customer opens (product pages count as product views).
  useEffect(() => {
    if (!store) return;
    const m = /\/p\/([^/]+)$/.exec(location.pathname);
    track(slug, m ? "product_view" : "page_view", m ? { productId: m[1] } : {});
  }, [location.pathname, slug, Boolean(store)]);
  useEffect(() => { setQ(params.get("q") ?? ""); }, [params]);
  useThemeStyle(store?.appearance);
  const consent = useConsent();

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
      {!checkout && <AnnouncementBar />}
      <header className="st-header">
        <div className="st-wrap st-header__row">
          <Link to={link()} className="st-brand" aria-label={`${store.name}, inicio`}>
            {store.logo && <img src={imageUrl(store.logo)!} alt="" />}
            <span className="st-brand__name">{store.name}</span>
          </Link>
          {!checkout && (
            <form className="st-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(link(q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "")); }}>
              <div className="nx-input-group">
                <svg className="nx-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input className="nx-input" type="search" placeholder="Buscar productos" aria-label="Buscar productos" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </form>
          )}
          {ready && (
            <Link
              to={link(account ? "/cuenta" : "/entrar")}
              className="st-account-btn"
              aria-label={account ? `Mi cuenta, ${account.name}` : "Entrar o crear cuenta"}
              style={checkout ? { marginLeft: "auto" } : undefined}
            >
              <UserRound size={17} strokeWidth={1.6} aria-hidden="true" />
              <span className="st-account-btn__label">{account ? firstName(account.name) : "Entrar"}</span>
            </Link>
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
          {store.policies.length > 0 && (
            <nav className="st-footer__legal" aria-label="Políticas">
              {store.policies.map((p) => <Link key={p.kind} to={link(`/${POLICY_INFO[p.kind].path}`)}>{POLICY_INFO[p.kind].title}</Link>)}
            </nav>
          )}
          <div className="st-powered">
            Tienda creada con Nexo
            {consent.needed && <> · <button type="button" className="st-linklike" onClick={consent.reopen}>Cookies</button></>}
          </div>
        </div>
      </footer>
      {whatsapp && !checkout && (
        <a className="st-wa" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={18} strokeWidth={1.6} aria-hidden="true" /><span className="st-wa__label">¿Dudas? Escríbenos</span></a>
      )}
      <CartDrawer />
      <ConsentBanner c={consent} />
    </>
  );
}
