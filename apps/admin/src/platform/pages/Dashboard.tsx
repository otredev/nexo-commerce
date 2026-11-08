import { Link } from "react-router-dom";
import { formatMoney, PLANS, PLAN_IDS, type PlatformMetrics } from "@nexo/shared";
import { Alert, Card, PageHeader, Stat } from "@nexo/ui";
import { DayBars, fmtDay, HBars } from "../../components/charts";
import { get } from "../../lib/api";
import { useLoad } from "../../lib/hooks";

const num = (n: number) => n.toLocaleString("es-MX");
const many = (n: number, one: string, other: string) => `${num(n)} ${n === 1 ? one : other}`;
const monthFmt = new Intl.DateTimeFormat("es-MX", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLabel = (date: string) => monthFmt.format(new Date(`${date.slice(0, 7)}-15T12:00:00Z`)).replace(".", "");
const monthLong = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });

export function DashboardPage() {
  const { data: m, error } = useLoad(() => get<PlatformMetrics>("/platform/metrics"), []);
  return (
    <>
      <PageHeader title="Inicio" description="Cómo va la plataforma: negocios, ingresos, actividad y soporte." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!m && !error && <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>}
      {m && (
        <>
          {m.support.open > 0 && (
            <Alert tone="info" title={`${m.support.open} ${m.support.open === 1 ? "ticket espera" : "tickets esperan"} respuesta`}>
              {m.support.unassigned > 0 && `${m.support.unassigned} sin asignar. `}<Link className="nx-link" to="/soporte">Ir a soporte</Link>
            </Alert>
          )}
          {m.billing.pastDue > 0 && (
            <Alert tone="warning" title={`${m.billing.pastDue} ${m.billing.pastDue === 1 ? "negocio tiene" : "negocios tienen"} un pago pendiente`}>
              Stripe sigue intentando cobrar. Si no se resuelve, el plan vuelve a Gratis al cancelarse la suscripción.
            </Alert>
          )}
          <div className="nx-stat-grid">
            <Stat label="Negocios activos" value={num(m.tenants.active)} meta={`${num(m.tenants.newThisMonth)} nuevos este mes · ${num(m.tenants.newLastMonth)} el anterior`} />
            <Stat label="Ingreso mensual recurrente" value={formatMoney(m.billing.mrrCents)} meta={`${num(m.billing.subscribed)} suscripciones${m.billing.courtesy ? ` · ${num(m.billing.courtesy)} de cortesía` : ""}${m.billing.trialing ? ` · ${num(m.billing.trialing)} en prueba` : ""}`} />
            <Stat label="Usuarios" value={num(m.users.total)} meta={`${num(m.users.newLast30d)} nuevos en 30 días${m.users.disabled ? ` · ${num(m.users.disabled)} desactivados` : ""}`} />
            <Stat label="Soporte" value={num(m.support.open)} meta={`por responder · ${num(m.support.waiting)} esperando al negocio`} />
          </div>

          <div className="nx-grid-2">
            <Card
              title="Actividad de los últimos 30 días"
              description={`${num(m.activity.sales30d)} ventas en caja y ${num(m.activity.orders30d)} pedidos en línea, de ${num(m.activity.activeTenants30d)} ${m.activity.activeTenants30d === 1 ? "negocio" : "negocios"}.`}
            >
              <DayBars
                label="Ventas y pedidos por día"
                points={m.activity.days.map((d) => ({ date: d.date, value: d.sales + d.orders, tip: `${fmtDay(d.date)}: ${num(d.sales)} ventas · ${num(d.orders)} pedidos` }))}
              />
              {m.activity.volumeByCurrency.length > 0 && (
                <dl className="nx-kv" style={{ marginTop: 16 }}>
                  {m.activity.volumeByCurrency.map((v) => (
                    <div key={v.currency}><dt>Vendido en caja ({v.currency})</dt><dd>{formatMoney(v.cents, v.currency)}</dd></div>
                  ))}
                </dl>
              )}
            </Card>
            <Card title="Negocios por plan" description={`${num(m.tenants.total)} en total · ${num(m.tenants.suspended)} suspendidos`}>
              <HBars rows={PLAN_IDS.map((p) => ({ key: p, label: PLANS[p].name, value: m.byPlan[p] }))} format={num} empty="Aún no hay negocios." />
            </Card>
          </div>

          <div className="nx-grid-2">
            <Card title="Negocios nuevos por mes" description="Últimos 12 meses.">
              <DayBars
                label="Negocios nuevos por mes"
                labelOf={monthLabel}
                points={m.signups.map((s) => ({ date: `${s.month}-01`, value: s.count, tip: `${monthLong.format(new Date(`${s.month}-15T12:00:00Z`))}: ${num(s.count)}` }))}
              />
            </Card>
            <Card title="Más activos" description="Ventas y pedidos de 30 días.">
              {m.activity.top.length === 0 ? (
                <p className="nx-muted" style={{ margin: 0 }}>Sin actividad todavía.</p>
              ) : (
                <ol className="nx-ranking">
                  {m.activity.top.map((t) => (
                    <li key={t.tenantId}>
                      <Link className="nx-link" to={`/negocios/${t.tenantId}`}>{t.name}</Link>
                      <span className="nx-muted nx-num">{many(t.sales, "venta", "ventas")} · {many(t.orders, "pedido", "pedidos")}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
