import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { ToastProvider } from "@nexo/ui";
import "@nexo/ui/styles.css";
import "@nexo/ui/theme-fonts.css";
import "./store.css";
import { StoreProvider } from "./lib/store";
import { StoreLayout } from "./components/Layout";
import { CatalogPage } from "./pages/Catalog";
import { ProductPage } from "./pages/Product";
import { CheckoutPage } from "./pages/Checkout";
import { OrderPage } from "./pages/Order";
import { PolicyPage } from "./pages/Policy";
import { POLICY_INFO, POLICY_KINDS } from "@nexo/shared";

/** On a business's own domain the server injects its slug and the store lives at the root. */
const ownDomainSlug = (window as { __NX_STORE__?: { slug: string } }).__NX_STORE__?.slug ?? null;

function Store() {
  const { slug } = useParams();
  const s = (ownDomainSlug ?? slug!).toLowerCase();
  return (
    <StoreProvider slug={s} base={ownDomainSlug ? "" : `/${s}`}>
      <StoreLayout />
    </StoreProvider>
  );
}

const storePages = (
  <>
    <Route index element={<CatalogPage />} />
    <Route path="p/:id" element={<ProductPage />} />
    <Route path="pagar" element={<CheckoutPage />} />
    <Route path="pedido/:token" element={<OrderPage />} />
    {POLICY_KINDS.map((k) => <Route key={k} path={POLICY_INFO[k].path} element={<PolicyPage kind={k} />} />)}
    <Route path="*" element={<NotFound />} />
  </>
);

function Landing() {
  return (
    <div className="st-wrap st-empty">
      <h1 className="st-empty__title">Tiendas Nexo</h1>
      <p className="st-empty__text">Abre el enlace de la tienda que quieres visitar, por ejemplo <span className="nx-mono">/mi-negocio</span>.</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="st-wrap st-empty">
      <h1 className="st-empty__title">Página no encontrada</h1>
      <p className="st-empty__text">Revisa la dirección.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          {ownDomainSlug ? (
            <Route path="/" element={<Store />}>{storePages}</Route>
          ) : (
            <>
              <Route path="/" element={<Landing />} />
              <Route path="/:slug" element={<Store />}>{storePages}</Route>
            </>
          )}
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
