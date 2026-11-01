import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { ToastProvider } from "@nexo/ui";
import "@nexo/ui/styles.css";
import "./store.css";
import { StoreProvider } from "./lib/store";
import { StoreLayout } from "./components/Layout";
import { CatalogPage } from "./pages/Catalog";
import { ProductPage } from "./pages/Product";
import { CheckoutPage } from "./pages/Checkout";
import { OrderPage } from "./pages/Order";

function Store() {
  const { slug } = useParams();
  return (
    <StoreProvider slug={slug!.toLowerCase()}>
      <StoreLayout />
    </StoreProvider>
  );
}

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
          <Route path="/" element={<Landing />} />
          <Route path="/:slug" element={<Store />}>
            <Route index element={<CatalogPage />} />
            <Route path="p/:id" element={<ProductPage />} />
            <Route path="pagar" element={<CheckoutPage />} />
            <Route path="pedido/:token" element={<OrderPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
