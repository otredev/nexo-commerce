/**
 * Tienda en línea → Estadísticas (Phase 10): visitors, conversion, sales, sources, campaigns, devices,
 * countries and products of the online store for a period, compared with the period before.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import {
  ANALYTICS_MAX_DAYS, businessDate, changePct, daysBetween, DEVICE_LABELS, FULFILLMENT_LABELS, ONLINE_PAYMENT_LABELS, ORDER_STATUS_LABELS, sourceLabel,
  type OrderStatus, type StoreAnalytics,
} from "@nexo/shared";
import { Alert, Button, Card, PageHeader, Segmented, Stat } from "@nexo/ui";
import { get } from "../lib/api";
import { useBusiness } from "../lib/business";
import { downloadText, toCsv } from "../lib/csv";
import { useLoad } from "../lib/hooks";
import { DayBars, Delta, fmtDay, HBars, pct } from "../components/charts";

type Preset = "7d" | "30d" | "month" | "lastMonth" | "90d" | "custom";
const shift = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
function rangeFor(preset: Preset, today: string): [string, string] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (preset) {
    case "30d": return [shift(today, -29), today];
    case "90d": return [shift(today, -89), today];
    case "month": return [`${y}-${pad(m)}-01`, today];
    case "lastMonth": return [m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`, shift(`${y}-${pad(m)}-01`, -1)];
    default: return [shift(today, -6), today];
  }
}
const int = (n: number) => n.toLocaleString("es-MX");
const regionNames = (() => { try { return new Intl.DisplayNames(["es-MX"], { type: "region" }); } catch { return null; } })();
const countryName = (code: string) => { try { return regionNames?.of(code.toUpperCase()) ?? code; } catch { return code; } };

export function StoreAnalyticsPage() {
  const { settings, money } = useBusiness();
  const today = businessDate(settings?.timezone ?? "America/Mexico_City");
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState<[string, string]>([shift(today, -29), today]);
  const [from, to] = preset === "custom" ? custom : rangeFor(preset, today);
  const tooLong = daysBetween(from, to) > ANALYTICS_MAX_DAYS;
  const { data: r, error, loading } = useLoad(() => (tooLong ? Promise.resolve(null) : get<StoreAnalytics>(`/reports/store?from=${from}&to=${to}`)), [from, to, tooLong]);
  const [sort, setSort] = useState<"salesCents" | "views" | "quantity">("salesCents");
  const products = useMemo(() => (r ? [...r.products].sort((a, b) => ((b[sort] ?? 0) as number) - ((a[sort] ?? 0) as number)) : []), [r, sort]);

  const exportCsv = () => {
    if (!r) return;
    const days = toCsv([["Fecha", "Visitantes", "Vistas", "Pedidos", "Ventas"], ...r.days.map((d) => [d.date, d.visitors ?? "", d.views ?? "", d.orders, (d.salesCents / 100).toFixed(2)])]);
    const prods = toCsv([["Producto", "Vistas", "Agregado al carrito", "Cantidad vendida", "Pedidos", "Ventas"], ...products.map((p) => [p.name, p.views ?? "", p.addToCart ?? "", p.quantity, p.orders, (p.salesCents / 100).toFixed(2)])]);
    downloadText(`tienda-${from}-a-${to}.csv`, `﻿${days}\n\n${prods}`);
  };

  const s = r?.sales;
  const tr = r?.traffic;
  const live = s ? s.orders - s.cancelled : 0;
  const prevConv = r?.previousConversionPct ?? null;

  return (
    <>
      <PageHeader
        title="Estadísticas de la tienda"
        description="Quién visita tu tienda en línea, de dónde llega, qué ve y qué compra."
        actions={<Button onClick={exportCsv} disabled={!r}><Download className="nx-icon" aria-hidden="true" />Exportar CSV</Button>}
      />
      <div className="nx-presets">
        <Segmented
          label="Periodo"
          value={preset}
          onChange={setPreset}
          options={[{ id: "7d", label: "7 días" }, { id: "30d", label: "30 días" }, { id: "month", label: "Este mes" }, { id: "lastMonth", label: "Mes pasado" }, { id: "90d", label: "90 días" }, { id: "custom", label: "Otro" }]}
        />
        {preset === "custom" && (
          <>
            <input className="nx-input" type="date" aria-label="Desde" value={custom[0]} min={shift(today, -120)} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
            <input className="nx-input" type="date" aria-label="Hasta" value={custom[1]} min={custom[0]} max={today} onChange={(e) => setCustom([custom[0], e.target.value])} />
          </>
        )}
        <span className="nx-muted" style={{ fontSize: 13, marginLeft: "auto" }}>{fmtDay(from)} – {fmtDay(to)}{r && <> · comparado con {fmtDay(r.previousFrom)} – {fmtDay(r.previousTo)}</>}</span>
      </div>
      {tooLong && <Alert tone="warning">Elige un periodo de hasta {ANALYTICS_MAX_DAYS} días: las visitas se guardan 3 meses.</Alert>}
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!r || !s || !tr ? (
        !tooLong && <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>
      ) : (
        <div className="nx-stack" style={{ gap: 24, opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          {!tr.available && (
            tr.reason === "not_configured"
              ? <Alert tone="info" title="Las visitas aún no están disponibles">Los pedidos y ventas sí. Para ver visitantes, fuentes y conversión, la plataforma debe tener configurado Analytics Engine de Cloudflare (ver README → Desplegar).</Alert>
              : <Alert tone="warning" title="No pudimos leer las visitas">Los pedidos y ventas están completos. Intenta de nuevo en unos minutos.</Alert>
          )}
          <div className="nx-stat-grid">
            {tr.available && <Stat label="Visitantes" value={int(tr.visitors)} meta={<Delta value={changePct(tr.visitors, tr.previousVisitors)} />} />}
            <Stat label="Pedidos" value={int(live)} meta={<Delta value={changePct(live, s.previousOrders)} />} />
            <Stat label="Ventas" value={money(s.salesCents)} meta={<Delta value={changePct(s.salesCents, s.previousSalesCents)} />} />
            <Stat label="Ticket promedio" value={money(s.avgOrderCents)} meta={s.cancelled ? `${s.cancelled} ${s.cancelled === 1 ? "pedido cancelado" : "pedidos cancelados"} (no cuentan)` : "Sin pedidos cancelados"} />
            {r.conversionPct !== null && <Stat label="Conversión" value={pct(r.conversionPct)} meta={prevConv === null ? "Pedidos por cada visitante" : <Delta value={r.conversionPct - prevConv} points />} />}
          </div>

          <div className={tr.available ? "nx-halves" : "nx-stack"}>
            {tr.available && (
              <Card title="Visitantes por día">
                <DayBars label="Visitantes por día" points={r.days.map((d) => ({ date: d.date, value: d.visitors ?? 0, tip: `${fmtDay(d.date)} · ${int(d.visitors ?? 0)} visitantes · ${int(d.views ?? 0)} páginas` }))} />
              </Card>
            )}
            <Card title="Ventas por día" description="Pedidos no cancelados, por fecha en que se hicieron.">
              <DayBars label="Ventas por día" points={r.days.map((d) => ({ date: d.date, value: d.salesCents, tip: `${fmtDay(d.date)} · ${money(d.salesCents)} · ${d.orders} ${d.orders === 1 ? "pedido" : "pedidos"}` }))} />
            </Card>
          </div>

          {tr.available && <Funnel f={tr.funnel} />}

          {tr.available && (
            <div className="nx-halves">
              <Card title="De dónde llegan" description="Visitantes por el sitio que los trajo.">
                <HBars rows={tr.sources.map((x) => ({ key: x.source || "direct", label: sourceLabel(x.source), value: x.visitors }))} format={int} empty="Sin visitas en el periodo." />
              </Card>
              <Card title="Campañas" description={<>Enlaces con <code>utm_source</code>, <code>utm_medium</code> y <code>utm_campaign</code>.</>}>
                {tr.campaigns.length === 0 ? (
                  <p className="nx-muted" style={{ margin: 0 }}>Sin visitas de campañas. Agrega <code>?utm_source=instagram&amp;utm_campaign=otono</code> a los enlaces que compartes para medirlos aquí.</p>
                ) : (
                  <HBars rows={tr.campaigns.map((x) => ({ key: `${x.source}|${x.medium}|${x.campaign}`, label: [x.source, x.campaign || x.medium].filter(Boolean).join(" · "), value: x.visitors }))} format={int} empty="" />
                )}
              </Card>
              <Card title="Dispositivos">
                <HBars rows={tr.devices.map((x) => ({ key: x.device, label: DEVICE_LABELS[x.device] ?? x.device, value: x.visitors }))} format={int} empty="Sin visitas en el periodo." />
              </Card>
              <Card title="Países">
                <HBars rows={tr.countries.map((x) => ({ key: x.country, label: countryName(x.country), value: x.visitors }))} format={int} empty="Sin visitas en el periodo." />
              </Card>
            </div>
          )}

          <div className="nx-table-wrap">
            <div className="nx-table-toolbar">
              <span style={{ fontWeight: 600 }}>Productos</span>
              <Segmented
                label="Ordenar productos"
                value={sort}
                onChange={setSort}
                options={[{ id: "salesCents", label: "Más vendidos" }, ...(tr.available ? [{ id: "views" as const, label: "Más vistos" }] : []), { id: "quantity", label: "Más piezas" }]}
              />
            </div>
            {products.length === 0 ? (
              <p className="nx-muted" style={{ padding: "8px 16px 20px", margin: 0 }}>Sin pedidos ni visitas a productos en el periodo.</p>
            ) : (
              <div className="nx-table-scroll" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table className="nx-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      {tr.available && <th className="nx-col-num">Vistas</th>}
                      {tr.available && <th className="nx-col-num">Al carrito</th>}
                      <th className="nx-col-num">Vendidos</th>
                      <th className="nx-col-num">Pedidos</th>
                      <th className="nx-col-num">Ventas</th>
                      {tr.available && <th className="nx-col-num" title="Pedidos por cada 100 vistas">Conversión</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {products.slice(0, 100).map((p) => (
                      <tr key={p.productId}>
                        <td><Link className="nx-link" to={`/productos/${p.productId}`}>{p.name}</Link></td>
                        {tr.available && <td className="nx-col-num">{int(p.views ?? 0)}</td>}
                        {tr.available && <td className="nx-col-num">{int(p.addToCart ?? 0)}</td>}
                        <td className="nx-col-num">{p.quantity.toLocaleString("es-MX", { maximumFractionDigits: 3 })}</td>
                        <td className="nx-col-num">{int(p.orders)}</td>
                        <td className="nx-col-num">{money(p.salesCents)}</td>
                        {tr.available && <td className="nx-col-num">{p.views ? pct(Math.min(100, (p.orders / p.views) * 100)) : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="nx-halves">
            <Card title="Formas de pago" description="Valor de los pedidos no cancelados.">
              <HBars rows={s.byPayment.map((x) => ({ key: x.method, label: ONLINE_PAYMENT_LABELS[x.method as keyof typeof ONLINE_PAYMENT_LABELS] ?? x.method, value: x.salesCents, sub: `${x.orders} ${x.orders === 1 ? "pedido" : "pedidos"}` }))} format={money} empty="Sin pedidos en el periodo." />
            </Card>
            <Card title="Entrega">
              <HBars rows={s.byFulfillment.map((x) => ({ key: x.fulfillment, label: FULFILLMENT_LABELS[x.fulfillment as keyof typeof FULFILLMENT_LABELS] ?? x.fulfillment, value: x.salesCents, sub: `${x.orders} ${x.orders === 1 ? "pedido" : "pedidos"}` }))} format={money} empty="Sin pedidos en el periodo." />
              {s.shippingCents > 0 && <p className="nx-help" style={{ margin: "12px 0 0" }}>Cobrado por envío: {money(s.shippingCents)}</p>}
            </Card>
            <Card title="Estado de los pedidos" description="Todos los pedidos hechos en el periodo.">
              <HBars rows={s.byStatus.map((x) => ({ key: x.status, label: ORDER_STATUS_LABELS[x.status as OrderStatus] ?? x.status, value: x.orders }))} format={int} empty="Sin pedidos en el periodo." />
            </Card>
            <Card title="Clientes">
              {s.customers === 0 ? (
                <p className="nx-muted" style={{ margin: 0 }}>Sin pedidos en el periodo.</p>
              ) : (
                <HBars
                  rows={[
                    { key: "new", label: "Nuevos", value: s.customers - s.returningCustomers },
                    { key: "returning", label: "Ya habían comprado", value: s.returningCustomers },
                  ]}
                  format={int}
                  empty=""
                />
              )}
              {(s.coupons.length > 0 || s.discountCents > 0) && (
                <p className="nx-help" style={{ margin: "12px 0 0" }}>
                  Descuentos: {money(s.discountCents)}{s.coupons.length > 0 && <> · cupones: {s.coupons.map((c) => `${c.code} (${c.orders})`).join(", ")}</>}
                </p>
              )}
            </Card>
          </div>

          {tr.available && tr.pages.length > 0 && (
            <div className="nx-table-wrap">
              <div className="nx-table-toolbar"><span style={{ fontWeight: 600 }}>Páginas más vistas</span></div>
              <table className="nx-table">
                <thead><tr><th>Página</th><th className="nx-col-num">Vistas</th><th className="nx-col-num">Visitantes</th></tr></thead>
                <tbody>
                  {tr.pages.map((p) => <tr key={p.path}><td className="nx-mono" style={{ fontSize: 12.5 }}>{p.path}</td><td className="nx-col-num">{int(p.views)}</td><td className="nx-col-num">{int(p.visitors)}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
          <p className="nx-help" style={{ margin: 0 }}>
            Las visitas se cuentan sin cookies: un visitante es un navegador por día, y no se cuentan robots. Con mucho tráfico los números de visitas son estimados (muestreo de Cloudflare); los pedidos y ventas siempre son exactos.
          </p>
        </div>
      )}
    </>
  );
}

function Funnel({ f }: { f: StoreAnalytics["traffic"]["funnel"] }) {
  const steps = [
    { key: "visitors", label: "Visitaron la tienda", value: f.visitors },
    { key: "product", label: "Vieron un producto", value: f.viewedProduct },
    { key: "cart", label: "Agregaron al carrito", value: f.addedToCart },
    { key: "checkout", label: "Empezaron a pagar", value: f.startedCheckout },
    { key: "order", label: "Hicieron un pedido", value: f.ordered },
  ];
  const top = Math.max(f.visitors, 1);
  return (
    <Card title="Embudo de compra" description="Visitantes que llegaron a cada paso. La caída entre pasos muestra dónde se pierden las ventas.">
      <ol className="nx-funnel">
        {steps.map((st, i) => {
          const prev = i ? steps[i - 1]!.value : 0;
          const drop = i && prev ? 100 - (st.value / prev) * 100 : null;
          return (
            <li key={st.key}>
              <span className="nx-funnel__label">{st.label}</span>
              <div className="nx-funnel__track" aria-hidden="true"><div className="nx-funnel__fill" style={{ width: `${(st.value / top) * 100}%` }} /></div>
              <span className="nx-funnel__value">
                {int(st.value)}
                <small>{i === 0 ? "100 %" : pct((st.value / top) * 100)}{drop !== null && drop > 0 && ` · −${pct(drop)} vs. paso anterior`}</small>
              </span>
            </li>
          );
        })}
      </ol>
      {f.startedCheckout > f.ordered && (
        <p className="nx-help" style={{ margin: "12px 0 0" }}>
          {int(f.startedCheckout - f.ordered)} {f.startedCheckout - f.ordered === 1 ? "visitante empezó" : "visitantes empezaron"} a pagar sin terminar. Revisa costos de envío, formas de pago y el mínimo de compra.
        </p>
      )}
    </Card>
  );
}
