import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { BusinessSettings, InventorySummary, Location, Member, TaxRate } from "@nexo/shared";
import { bpsToPercent } from "@nexo/shared";
import { Alert, Card, PageHeader, Stat } from "@nexo/ui";
import { useBusiness } from "../lib/business";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/hooks";

export function HomePage() {
  const { me, can } = useAuth();
  const { money } = useBusiness();
  const canUsers = can("users:read");
  const { data, error, loading } = useLoad(async () => {
    const [settings, taxes, locations, users, summary] = await Promise.all([
      get<BusinessSettings>("/settings"),
      get<TaxRate[]>("/taxes"),
      get<Location[]>("/locations"),
      canUsers ? get<Member[]>("/users") : Promise.resolve(null),
      get<InventorySummary>("/inventory/summary"),
    ]);
    return { settings, taxes, locations, users, summary };
  }, [canUsers]);

  const firstName = me?.user.name.split(" ")[0] ?? "";
  const defaultTax = data?.taxes.find((t) => t.isDefault);
  const steps = data
    ? [
        { done: Boolean(data.settings.taxId && data.settings.address), text: "Completa los datos fiscales del negocio", to: "/configuracion" },
        { done: data.taxes.some((t) => t.rateBps > 0), text: "Configura los impuestos que cobras", to: "/configuracion?tab=impuestos" },
        { done: (data.users?.filter((u) => u.active).length ?? 0) > 1, text: "Invita a tu equipo", to: "/usuarios", hidden: !canUsers },
        { done: data.summary.products > 0, text: "Agrega tus productos o impórtalos desde un CSV", to: "/productos/nuevo" },
      ].filter((s) => !s.hidden)
    : [];

  return (
    <>
      <PageHeader title={`Hola, ${firstName}`} description={data && data.summary.products > 0 ? "Así va tu negocio hoy." : "Esto es lo que falta para empezar a vender."} />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {loading && <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>}
      {data && data.summary.products > 0 && (
        <div className="nx-stat-grid">
          <Stat label="Productos activos" value={data.summary.products} meta={`${data.summary.variants} variantes`} />
          <Stat label="Stock bajo" value={data.summary.lowStock} meta={<Link className="nx-link" to="/inventario?stock=low">Revisar</Link>} />
          <Stat label="Agotados" value={data.summary.outOfStock} meta={<Link className="nx-link" to="/inventario?stock=out">Revisar</Link>} />
          {data.summary.inventoryValueCents !== null && <Stat label="Valor del inventario" value={money(data.summary.inventoryValueCents)} meta="A costo promedio" />}
        </div>
      )}
      {data && (
        <div className="nx-grid-2">
          <Card title="Primeros pasos" description={`${steps.filter((s) => s.done).length} de ${steps.length} completados`}>
            <div className="nx-checklist">
              {steps.map((s) => (
                <div className="nx-checklist__item" data-done={s.done} key={s.text}>
                  <span className="nx-checklist__mark" aria-hidden="true">{s.done && <Check size={12} strokeWidth={2.5} />}</span>
                  <span className="nx-checklist__text">{s.text}</span>
                  {s.to && !s.done && <Link className="nx-link" style={{ fontSize: 13 }} to={s.to}>Ir</Link>}
                  <span className="nx-sr-only">{s.done ? "Completado" : "Pendiente"}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Tu negocio">
            <dl className="nx-stack" style={{ margin: 0, gap: 12 }}>
              {[
                ["Nombre", data.settings.tradeName],
                ["Moneda", data.settings.currency],
                ["Zona horaria", data.settings.timezone.replace(/_/g, " ")],
                ["Impuesto predeterminado", defaultTax ? `${defaultTax.name} (${bpsToPercent(defaultTax.rateBps)} %)` : "—"],
                ["Ubicaciones", String(data.locations.filter((l) => l.active).length)],
                ...(data.users ? [["Usuarios", String(data.users.filter((u) => u.active).length)]] : []),
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <dt className="nx-muted">{k}</dt>
                  <dd style={{ margin: 0, textAlign: "right", fontWeight: 500 }}>{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}
