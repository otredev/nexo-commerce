import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@nexo/ui";
import "@nexo/ui/styles.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { AppLayout } from "./layout/AppLayout";
import { LoginPage } from "./pages/Login";
import { RegisterPage } from "./pages/Register";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordReset";
import { HomePage } from "./pages/Home";
import { SettingsPage } from "./pages/Settings";
import { UsersPage } from "./pages/Users";
import { ActivityPage } from "./pages/Activity";
import { ProductsPage } from "./pages/Products";
import { ProductFormPage } from "./pages/ProductForm";
import { InventoryPage } from "./pages/Inventory";
import { MovementsPage } from "./pages/Movements";
import { CatalogNamesPage } from "./pages/CatalogNames";
import { BusinessProvider } from "./lib/business";
import type { ReactNode } from "react";

function Protected({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  if (!me) return <Navigate to="/ingresar" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return null;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/ingresar" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/registro" element={<PublicOnly><RegisterPage /></PublicOnly>} />
            <Route path="/recuperar" element={<ForgotPasswordPage />} />
            <Route path="/restablecer" element={<ResetPasswordPage />} />
            <Route element={<Protected><BusinessProvider><AppLayout /></BusinessProvider></Protected>}>
              <Route index element={<HomePage />} />
              <Route path="productos" element={<ProductsPage />} />
              <Route path="productos/nuevo" element={<ProductFormPage />} />
              <Route path="productos/:id" element={<ProductFormPage />} />
              <Route path="inventario" element={<InventoryPage />} />
              <Route path="inventario/movimientos" element={<MovementsPage />} />
              <Route path="catalogo" element={<CatalogNamesPage />} />
              <Route path="usuarios" element={<UsersPage />} />
              <Route path="configuracion" element={<SettingsPage />} />
              <Route path="actividad" element={<ActivityPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
