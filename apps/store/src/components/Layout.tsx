import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { MessageCircle, ShoppingBag, UserRound } from "lucide-react";
import { blockStyleVars, newBlock, POLICY_INFO, SOCIAL_NETWORKS, whatsappLink, type BlockOf } from "@nexo/shared";
import { Button } from "@nexo/ui";
import { imageUrl, track } from "../lib/api";
import { useStore } from "../lib/store";
import { firstName, useAccount } from "../lib/account";
import { CartDrawer } from "./CartDrawer";
import { AnnouncementBar, ConsentBanner, StoreLinkTo, useConsent, useThemeStyle } from "./Appearance";

/** The footer before the business customizes it: what it always showed. */
const DEFAULT_FOOTER = newBlock("footer", "pie").data;

export function StoreLayout() {
  const { store, error, slug, link, count, setCartOpen, preview } = useStore();
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
  // "Encabezado y menú" section: drawn here, on every page.
  const header = store?.appearance.blocks.find((b): b is BlockOf<"header"> => b.type === "header") ?? null;
  const theme = store?.appearance.theme;
  const headerVars = useMemo(() => (header && theme ? blockStyleVars(theme, header.style) : null), [header, theme]);
  // "Pie de página" section: also on every page.
  const footer = store?.appearance.blocks.find((b): b is BlockOf<"footer"> => b.type === "footer") ?? null;
  const footerVars = useMemo(() => (footer && theme ? blockStyleVars(theme, footer.style) : null), [footer, theme]);
  const footerRef = useRef<HTMLElement>(null);
  const footerSelected = Boolean(footer && preview?.selected === footer.id);
  useEffect(() => { if (footerSelected) footerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [footerSelected]);

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
  const h = header?.data ?? { logo: "logo_name", layout: "inline", search: true, account: true, sticky: true, links: [] };
  const checkout = location.pathname.endsWith("/pagar");
  const f = footer?.data ?? DEFAULT_FOOTER;
  const contact = [
    f.phone && store.phone && <a key="tel" href={`tel:${store.phone}`}>Tel. {store.phone}</a>,
    f.email && store.email && <a key="mail" href={`mailto:${store.email}`}>{store.email}</a>,
    f.whatsapp && whatsapp && <a key="wa" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>,
  ].filter(Boolean);
  const delivery = [
    f.delivery && store.pickupEnabled && <span key="pickup">Recoge en tienda sin costo</span>,
    f.delivery && store.deliveryEnabled && <span key="delivery">Envío a domicilio{store.deliveryArea ? ` · ${store.deliveryArea}` : ""}</span>,
  ].filter(Boolean);

  return (
    <>
      <a className="nx-sr-only" href="#contenido">Ir al contenido</a>
      {!checkout && <AnnouncementBar />}
      <header
        className="st-header"
        data-layout={h.layout}
        data-sticky={h.sticky ? undefined : "off"}
        data-paint={headerVars && "--bg" in headerVars.vars ? "" : undefined}
        data-selected={header && preview?.selected === header.id ? "" : undefined}
        style={headerVars ? ({ ...headerVars.vars, ...(headerVars.scheme && { colorScheme: headerVars.scheme }) } as CSSProperties) : undefined}
      >
        <div className="st-wrap st-header__row">
          <Link to={link()} className="st-brand" aria-label={`${store.name}, inicio`}>
            {store.logo && h.logo !== "name" && <img src={imageUrl(store.logo)!} alt="" data-big={h.logo === "logo" ? "" : undefined} />}
            {(h.logo !== "logo" || !store.logo) && <span className="st-brand__name">{store.name}</span>}
          </Link>
          {!checkout && h.search && (
            <form className="st-search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(link(q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "")); }}>
              <div className="nx-input-group">
                <svg className="nx-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input className="nx-input" type="search" placeholder="Buscar productos" aria-label="Buscar productos" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </form>
          )}
          <div className="st-header__actions" style={checkout || !h.search ? { marginLeft: "auto" } : undefined}>
            {ready && h.account && (
              <Link
                to={link(account ? "/cuenta" : "/entrar")}
                className="st-account-btn"
                aria-label={account ? `Mi cuenta, ${account.name}` : "Entrar o crear cuenta"}
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
        </div>
        {!checkout && h.links.length > 0 && (
          <nav className="st-menu" aria-label="Menú">
            <div className="st-wrap st-menu__row">
              {h.links.map((l, i) => <StoreLinkTo key={i} href={l.link} className="st-menu__link">{l.label}</StoreLinkTo>)}
            </div>
          </nav>
        )}
      </header>
      <main id="contenido">
        <Outlet />
      </main>
      <footer
        ref={footerRef}
        className="st-footer"
        data-paint={footerVars && "--bg" in footerVars.vars ? "" : undefined}
        data-selected={footerSelected ? "" : undefined}
        style={footerVars ? ({ ...footerVars.vars, ...(footerVars.scheme && { colorScheme: footerVars.scheme }) } as CSSProperties) : undefined}
      >
        <div className="st-wrap">
          <div className="st-footer__row">
            {(f.logo !== "none" || f.text || (f.address && store.address)) && (
              <div className="st-footer__about">
                {f.logo !== "none" && (
                  <Link to={link()} className="st-footer__brand" aria-label={`${store.name}, inicio`}>
                    {store.logo && f.logo !== "name" && <img src={imageUrl(store.logo)!} alt="" data-big={f.logo === "logo" ? "" : undefined} />}
                    {(f.logo !== "logo" || !store.logo) && <span>{store.name}</span>}
                  </Link>
                )}
                {f.text && <p className="st-footer__text">{f.text}</p>}
                {f.address && store.address && <div>{store.address}</div>}
              </div>
            )}
            {contact.length > 0 && <div className="st-footer__links">{contact}</div>}
            {delivery.length > 0 && <div className="st-footer__links">{delivery}</div>}
            {f.columns.map((c, i) => (
              <nav key={i} className="st-footer__links" aria-label={c.title ?? `Enlaces ${i + 1}`}>
                {c.title && <span className="st-footer__title">{c.title}</span>}
                {c.links.map((l, k) => <StoreLinkTo key={k} href={l.link}>{l.label}</StoreLinkTo>)}
              </nav>
            ))}
          </div>
          {f.social.length > 0 && (
            <nav className="st-footer__social" aria-label="Redes sociales">
              {f.social.map((x, i) => <a key={i} href={x.url} target="_blank" rel="noreferrer noopener">{SOCIAL_NETWORKS[x.network]}</a>)}
            </nav>
          )}
          {f.policies && store.policies.length > 0 && (
            <nav className="st-footer__legal" aria-label="Políticas">
              {store.policies.map((p) => <Link key={p.kind} to={link(`/${POLICY_INFO[p.kind].path}`)}>{POLICY_INFO[p.kind].title}</Link>)}
            </nav>
          )}
          {f.note && <p className="st-footer__note">{f.note}</p>}
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
