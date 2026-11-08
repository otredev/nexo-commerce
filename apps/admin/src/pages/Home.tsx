import { Link, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { bpsToPercent, formatQty, type BusinessSettings, type DashboardData, type InventorySummary, type Location, type Member, type TaxRate } from "@nexo/shared";
import { Alert, Badge, Button, Card, PageHeader, Stat } from "@nexo/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";
import { useLoad } from "../lib/hooks";

const dayFmt = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" });
const longDayFmt = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

export function HomePage() {
  const { me, can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const canUsers = can("users:read");
  const { data, error, loading } = useLoad(async () => {
    const [settings, taxes, locations, users, summary, dashboard] = await Promise.all([
      get<BusinessSettings>("/settings"),
      get<TaxRate[]>("/taxes"),
      get<Location[]>("/locations"),
      canUsers ? get<Member[]>("/users") : Promise.resolve(null),
      get<InventorySummary>("/inventory/summary"),
      get<DashboardData>("/reports/dashboard"),
    ]);
    return { settings, taxes, locations, users, summary, dashboard };
  }, [canUsers]);

  // In support mode the greeting is for the operator, not "Soporte".
  const firstName = (me?.support?.operatorName ?? me?.user.name ?? "").split(" ")[0] ?? "";
  const steps = data
    ? [
        { done: Boolean(data.settings.taxId && data.settings.address), text: "Completa los datos fiscales del negocio", to: "/configuracion" },
        { done: data.taxes.some((t) => t.rateBps > 0), text: "Configura los impuestos que cobras", to: "/configuracion?tab=impuestos" },
        { done: data.summary.products > 0, text: "Agrega tus productos o impórtalos desde un CSV", to: "/productos/nuevo" },
        { done: (data.users?.filter((u) => u.active).length ?? 0) > 1, text: "Invita a tu equipo", to: "/usuarios", hidden: !canUsers },
        { done: data.dashboard.days.some((d) => d.count > 0), text: "Haz tu primera venta en el punto de venta", to: "/pos" },
        { done: data.dashboard.orders !== null, text: "Abre tu tienda en línea", to: "/tienda", hidden: !can("store:write") },
      ].filter((s) => !s.hidden)
    : [];
  const pending = steps.filter((s) => !s.done).length;

  return (
    <>
      <PageHeader
        title={`Hola, ${firstName}`}
        description={data ? longDayFmt.format(new Date(`${data.dashboard.today}T12:00:00Z`)).replace(/^\w/, (c) => c.toUpperCase()) : undefined}
        actions={can("pos:sell") && <Button variant="primary" onClick={() => navigate("/pos")}>Abrir punto de venta</Button>}
      />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {loading && !data && <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>}
      {data && (
        <>
          <SalesStats data={data.dashboard} money={money} />
          <div className="nx-grid-2">
            <Card title="Ventas de los últimos 7 días" description="Total neto de devoluciones.">
              <WeekBars days={data.dashboard.days} money={money} />
            </Card>
            <Card title="Lo más vendido" description="Últimos 7 días.">
              {data.dashboard.topProducts.length === 0 ? (
                <p className="nx-muted" style={{ margin: 0 }}>Aún no hay ventas esta semana.</p>
              ) : (
                <ol className="nx-checklist" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {data.dashboard.topProducts.map((p, i) => (
                    <li key={`${p.productId}-${i}`} className="nx-checklist__item">
                      <span className="nx-muted nx-num" style={{ width: 16 }}>{i + 1}</span>
                      <span className="nx-checklist__text">
                        <Link to={`/productos/${p.productId}`} style={{ color: "inherit", textDecoration: "none" }}>{p.name}</Link>
                        {p.options.length > 0 && <span className="nx-muted"> · {p.options.join(" / ")}</span>}
                        <div className="nx-muted" style={{ fontSize: 12 }}>{formatQty(p.quantity, p.unit)}</div>
                      </span>
                      <span className="nx-num" style={{ fontWeight: 500 }}>{money(p.totalCents)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
          <div className="nx-stat-grid">
            {data.dashboard.orders && can("orders:read") && (
              <Stat label="Pedidos en línea" value={data.dashboard.orders.pending ? `${data.dashboard.orders.pending} nuevos` : data.dashboard.orders.open} meta={<Link className="nx-link" to="/pedidos">{data.dashboard.orders.open ? `${data.dashboard.orders.open} por atender` : "Ver pedidos"}</Link>} />
            )}
            <Stat label="Caja" value={data.dashboard.openSessions.length ? "Abierta" : "Cerrada"} meta={data.dashboard.openSessions.length ? data.dashboard.openSessions.map((s) => `${s.locationName} · ${s.openedBy ?? ""} desde ${timeFmt.format(new Date(s.openedAt))}`).join(" · ") : <Link className="nx-link" to="/pos">Abrir caja</Link>} />
            <Stat label="Stock bajo" value={data.summary.lowStock} meta={<Link className="nx-link" to="/inventario?stock=low">Revisar</Link>} />
            <Stat label="Agotados" value={data.summary.outOfStock} meta={<Link className="nx-link" to="/inventario?stock=out">Revisar</Link>} />
            {data.summary.inventoryValueCents !== null && <Stat label="Valor del inventario" value={money(data.summary.inventoryValueCents)} meta="A costo promedio" />}
          </div>
          {pending > 0 && (
            <div className="nx-grid-2">
              <Card title="Primeros pasos" description={`${steps.length - pending} de ${steps.length} completados`}>
                <div className="nx-checklist">
                  {steps.map((s) => (
                    <div className="nx-checklist__item" data-done={s.done} key={s.text}>
                      <span className="nx-checklist__mark" aria-hidden="true">{s.done && <Check size={12} strokeWidth={2.5} />}</span>
                      <span className="nx-checklist__text">{s.text}</span>
                      {!s.done && <Link className="nx-link" style={{ fontSize: 13 }} to={s.to}>Ir</Link>}
                      <span className="nx-sr-only">{s.done ? "Completado" : "Pendiente"}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Tu negocio">
                <dl className="nx-kv">
                  <div><dt>Moneda</dt><dd>{data.settings.currency}</dd></div>
                  <div><dt>Zona horaria</dt><dd>{data.settings.timezone.replace(/_/g, " ")}</dd></div>
                  <div><dt>Impuesto predeterminado</dt><dd>{(() => { const t = data.taxes.find((x) => x.isDefault); return t ? `${t.name} (${bpsToPercent(t.rateBps)} %)` : "—"; })()}</dd></div>
                  <div><dt>Ubicaciones</dt><dd>{data.locations.filter((l) => l.active).length}</dd></div>
                </dl>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}

function SalesStats({ data, money }: { data: DashboardData; money: (c: number | null | undefined) => string }) {
  const { sales } = data;
  const delta = sales.yesterdayTotalCents ? ((sales.totalCents - sales.yesterdayTotalCents) / sales.yesterdayTotalCents) * 100 : null;
  return (
    <div className="nx-stat-grid">
      <Stat
        label="Ventas de hoy"
        value={money(sales.totalCents)}
        meta={delta === null ? `${sales.count} ${sales.count === 1 ? "venta" : "ventas"}` : (
          <><span className={`nx-delta ${delta >= 0 ? "nx-delta--up" : "nx-delta--down"}`}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %</span>vs. ayer</>
        )}
      />
      <Stat label="Tickets" value={sales.count} meta={sales.onlineCount ? `${sales.onlineCount} en línea · ${money(sales.onlineTotalCents)}` : `Promedio ${money(sales.avgTicketCents)}`} />
      {sales.grossProfitCents !== null && (
        <Stat label="Utilidad bruta" value={money(sales.grossProfitCents)} meta={sales.totalCents ? `Margen ${((sales.grossProfitCents / sales.totalCents) * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %` : "Ventas menos costo"} />
      )}
      <Stat label="Ayer" value={money(sales.yesterdayTotalCents)} meta={<Link className="nx-link" to="/ventas">Ver ventas</Link>} />
    </div>
  );
}

/** Single-series bar chart: one hue, thin rounded bars, today labeled, hover/focus tooltip on every bar. */
function WeekBars({ days, money }: { days: DashboardData["days"]; money: (c: number) => string }) {
  const max = Math.max(...days.map((d) => d.totalCents), 1);
  const last = days[days.length - 1]!;
  return (
    <figure style={{ margin: 0 }}>
      <div className="nx-bars" role="img" aria-label={days.map((d) => `${longDayFmt.format(new Date(`${d.date}T12:00:00Z`))}: ${money(d.totalCents)}`).join("; ")}>
        {days.map((d) => {
          const h = Math.max(0, (d.totalCents / max) * 100);
          return (
            <div className="nx-bars__col" key={d.date} tabIndex={0}>
              {d === last && d.totalCents > 0 && <span className="nx-bars__value" style={{ bottom: `calc(${h}% + 4px)` }}>{money(d.totalCents)}</span>}
              <div className="nx-bars__bar" style={{ height: `${h}%` }} />
              <span className="nx-bars__tip" role="tooltip">{longDayFmt.format(new Date(`${d.date}T12:00:00Z`))} · {money(d.totalCents)} · {d.count} ventas</span>
            </div>
          );
        })}
      </div>
      <div className="nx-bars__labels" aria-hidden="true">
        {days.map((d) => <span key={d.date} style={d === last ? { color: "var(--ink)", fontWeight: 500 } : undefined}>{d === last ? "Hoy" : dayFmt.format(new Date(`${d.date}T12:00:00Z`)).replace(".", "")}</span>)}
      </div>
      <Badge plain>{days.reduce((a, d) => a + d.count, 0)} ventas en la semana · {money(days.reduce((a, d) => a + d.totalCents, 0))}</Badge>
    </figure>
  );
}
