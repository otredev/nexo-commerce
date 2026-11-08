/**
 * Nexo · Administración (/admin): the platform operators' panel. A separate app from the business
 * dashboard, with its own sign-in (operator accounts) and its own look.
 */
import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@nexo/ui";
import "@nexo/ui/styles.css";
import "./platform.css";
import { OperatorProvider, useOperator } from "./auth";
import { PlatformLayout } from "./Layout";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
const TenantsPage = lazy(() => import("./pages/Tenants").then((m) => ({ default: m.TenantsPage })));
const TenantDetailPage = lazy(() => import("./pages/TenantDetail").then((m) => ({ default: m.TenantDetailPage })));
const UsersPage = lazy(() => import("./pages/Users").then((m) => ({ default: m.UsersPage })));
const UserDetailPage = lazy(() => import("./pages/Users").then((m) => ({ default: m.UserDetailPage })));
const TicketsPage = lazy(() => import("./pages/Tickets").then((m) => ({ default: m.TicketsPage })));
const TicketDetailPage = lazy(() => import("./pages/TicketDetail").then((m) => ({ default: m.TicketDetailPage })));
const AuditPage = lazy(() => import("./pages/Audit").then((m) => ({ default: m.AuditPage })));
const OperatorsPage = lazy(() => import("./pages/Operators").then((m) => ({ default: m.OperatorsPage })));

const Loading = () => <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;

function Protected({ children }: { children: ReactNode }) {
  const { me, ready } = useOperator();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!me) return <Navigate to="/ingresar" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <OperatorProvider>
        <ToastProvider>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/ingresar" element={<LoginPage />} />
              <Route element={<Protected><PlatformLayout /></Protected>}>
                <Route index element={<DashboardPage />} />
                <Route path="negocios" element={<TenantsPage />} />
                <Route path="negocios/:id" element={<TenantDetailPage />} />
                <Route path="usuarios" element={<UsersPage />} />
                <Route path="usuarios/:id" element={<UserDetailPage />} />
                <Route path="soporte" element={<TicketsPage />} />
                <Route path="soporte/:id" element={<TicketDetailPage />} />
                <Route path="bitacora" element={<AuditPage />} />
                <Route path="operadores" element={<OperatorsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </OperatorProvider>
    </BrowserRouter>
  </StrictMode>,
);
