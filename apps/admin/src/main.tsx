import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@nexo/ui";
import "@nexo/ui/styles.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { PwaBridge, registerServiceWorker } from "./lib/pwa";
import { AppLayout } from "./layout/AppLayout";
import { LoginPage } from "./pages/Login";
import { RegisterPage } from "./pages/Register";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordReset";
import { HomePage } from "./pages/Home";
import { SettingsPage } from "./pages/Settings";
import { UsersPage } from "./pages/Users";
import { ActivityPage } from "./pages/Activity";
import { ProductsPage } from "./pages/Products";
const ProductFormPage = lazy(() => import("./pages/ProductForm").then((m) => ({ default: m.ProductFormPage })));
import { InventoryPage } from "./pages/Inventory";
import { MovementsPage } from "./pages/Movements";
import { CatalogNamesPage } from "./pages/CatalogNames";
import { BusinessProvider } from "./lib/business";
const PosPage = lazy(() => import("./pages/pos/PosPage").then((m) => ({ default: m.PosPage })));
const ReceiptPage = lazy(() => import("./pages/Receipt").then((m) => ({ default: m.ReceiptPage })));
import { SalesPage } from "./pages/Sales";
import { SaleDetailPage } from "./pages/SaleDetail";
import { CashSessionPage, CashSessionsPage } from "./pages/CashSessions";
import { SuppliersPage } from "./pages/Suppliers";
import { PurchasesPage } from "./pages/purchases/Purchases";
import { TransfersPage } from "./pages/transfers/Transfers";
import { CountsPage } from "./pages/counts/Counts";
import { OrdersPage } from "./pages/orders/Orders";
import { CustomersPage } from "./pages/customers/Customers";
const CustomerDetailPage = lazy(() => import("./pages/customers/CustomerDetail").then((m) => ({ default: m.CustomerDetailPage })));
const PromotionsPage = lazy(() => import("./pages/Promotions").then((m) => ({ default: m.PromotionsPage })));
const PayablesPage = lazy(() => import("./pages/Payables").then((m) => ({ default: m.PayablesPage })));
const ReportsPage = lazy(() => import("./pages/Reports").then((m) => ({ default: m.ReportsPage })));
const OrderDetailPage = lazy(() => import("./pages/orders/OrderDetail").then((m) => ({ default: m.OrderDetailPage })));
const StoreSettingsPage = lazy(() => import("./pages/StoreSettings").then((m) => ({ default: m.StoreSettingsPage })));
const PurchaseFormPage = lazy(() => import("./pages/purchases/PurchaseForm").then((m) => ({ default: m.PurchaseFormPage })));
const PurchaseDetailPage = lazy(() => import("./pages/purchases/PurchaseDetail").then((m) => ({ default: m.PurchaseDetailPage })));
const TransferFormPage = lazy(() => import("./pages/transfers/TransferForm").then((m) => ({ default: m.TransferFormPage })));
const TransferDetailPage = lazy(() => import("./pages/transfers/TransferDetail").then((m) => ({ default: m.TransferDetailPage })));
const CountDetailPage = lazy(() => import("./pages/counts/CountDetail").then((m) => ({ default: m.CountDetailPage })));
import type { ReactNode } from "react";
import { BlockedScreen } from "./pages/Blocked";
const LocalDisplayPage = lazy(() => import("./pages/pos/Display").then((m) => ({ default: m.LocalDisplayPage })));
const PairedDisplayPage = lazy(() => import("./pages/pos/Display").then((m) => ({ default: m.PairedDisplayPage })));
const PlatformPage = lazy(() => import("./pages/Platform").then((m) => ({ default: m.PlatformPage })));

function Protected({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  if (!me) return <Navigate to="/ingresar" replace state={{ from: location.pathname }} />;
  if (me.tenant.status === "suspended" || me.tenant.status === "migrating") return <BlockedScreen />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return null;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PwaBridge />
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>}>
          <Routes>
            <Route path="/ingresar" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/registro" element={<PublicOnly><RegisterPage /></PublicOnly>} />
            <Route path="/recuperar" element={<ForgotPasswordPage />} />
            <Route path="/restablecer" element={<ResetPasswordPage />} />
            <Route path="/pos" element={<Protected><BusinessProvider><PosPage /></BusinessProvider></Protected>} />
            <Route path="/pos/cliente" element={<Protected><LocalDisplayPage /></Protected>} />
            <Route path="/pantalla" element={<PairedDisplayPage />} />
            <Route path="/recibo/:id" element={<Protected><BusinessProvider><ReceiptPage /></BusinessProvider></Protected>} />
            <Route element={<Protected><BusinessProvider><AppLayout /></BusinessProvider></Protected>}>
              <Route index element={<HomePage />} />
              <Route path="productos" element={<ProductsPage />} />
              <Route path="productos/nuevo" element={<ProductFormPage />} />
              <Route path="productos/:id" element={<ProductFormPage />} />
              <Route path="inventario" element={<InventoryPage />} />
              <Route path="inventario/movimientos" element={<MovementsPage />} />
              <Route path="catalogo" element={<CatalogNamesPage />} />
              <Route path="ventas" element={<SalesPage />} />
              <Route path="ventas/:id" element={<SaleDetailPage />} />
              <Route path="caja" element={<CashSessionsPage />} />
              <Route path="caja/:id" element={<CashSessionPage />} />
              <Route path="compras" element={<PurchasesPage />} />
              <Route path="compras/nueva" element={<PurchaseFormPage />} />
              <Route path="compras/:id" element={<PurchaseDetailPage />} />
              <Route path="compras/:id/editar" element={<PurchaseFormPage />} />
              <Route path="proveedores" element={<SuppliersPage />} />
              <Route path="traspasos" element={<TransfersPage />} />
              <Route path="traspasos/nuevo" element={<TransferFormPage />} />
              <Route path="traspasos/:id" element={<TransferDetailPage />} />
              <Route path="traspasos/:id/editar" element={<TransferFormPage />} />
              <Route path="conteos" element={<CountsPage />} />
              <Route path="conteos/:id" element={<CountDetailPage />} />
              <Route path="clientes" element={<CustomersPage />} />
              <Route path="clientes/:id" element={<CustomerDetailPage />} />
              <Route path="promociones" element={<PromotionsPage />} />
              <Route path="cuentas-por-pagar" element={<PayablesPage />} />
              <Route path="reportes" element={<ReportsPage />} />
              <Route path="pedidos" element={<OrdersPage />} />
              <Route path="pedidos/:id" element={<OrderDetailPage />} />
              <Route path="tienda" element={<StoreSettingsPage />} />
              <Route path="usuarios" element={<UsersPage />} />
              <Route path="configuracion" element={<SettingsPage />} />
              <Route path="actividad" element={<ActivityPage />} />
              <Route path="plataforma" element={<PlatformPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
