import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { businessDate, formatQty, type InventoryReport, type SalesReport } from "@nexo/shared";
import { Alert, Button, Card, PageHeader, Segmented, Stat, Tabs } from "@nexo/ui";
import { get } from "../lib/api";
import { useBusiness } from "../lib/business";
import { downloadText, toCsv } from "../lib/csv";
import { useLoad } from "../lib/hooks";
import { dateFmt } from "../components/docs";

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";
const shift = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
function rangeFor(preset: Preset, today: string): [string, string] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (preset) {
    case "yesterday": return [shift(today, -1), shift(today, -1)];
    case "7d": return [shift(today, -6), today];
    case "30d": return [shift(today, -29), today];
    case "month": return [`${y}-${pad(m)}-01`, today];
    case "lastMonth": {
      const first = m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
      return [first, shift(`${y}-${pad(m)}-01`, -1)];
    }
    default: return [today, today];
  }
}
const dayFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const pct = (n: number) => `${n.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;

export function ReportsPage() {
  const [tab, setTab] = useState<"sales" | "inventory">("sales");
  return (
    <>
      <PageHeader title="Reportes" description="Cómo va el negocio: ventas, utilidad, productos, formas de pago, personal e inventario." />
      <Tabs label="Reporte" value={tab} onChange={setTab} tabs={[{ id: "sales", label: "Ventas" }, { id: "inventory", label: "Inventario" }]} />
      {tab === "sales" ? <SalesTab /> : <InventoryTab />}
    </>
  );
}

function SalesTab() {
  const { settings, money } = useBusiness();
  const today = businessDate(settings?.timezone ?? "America/Mexico_City");
  const [preset, setPreset] = useState<Preset>("7d");
  const [custom, setCustom] = useState<[string, string]>([shift(today, -6), today]);
  const [from, to] = preset === "custom" ? custom : rangeFor(preset, today);
  const { data: r, error, loading } = useLoad(() => get<SalesReport>(`/reports/sales?from=${from}&to=${to}`), [from, to]);
  const [sort, setSort] = useState<"netCents" | "quantity" | "profitCents">("netCents");
  const products = useMemo(() => (r ? [...r.products].sort((a, b) => ((b[sort] ?? 0) as number) - ((a[sort] ?? 0) as number)) : []), [r, sort]);

  const exportProducts = () => {
    if (!r) return;
    downloadText(
      `productos-${from}-a-${to}.csv`,
      `﻿${toCsv([
        ["Producto", "Variante", "SKU", "Cantidad", "Ventas", "Costo", "Utilidad"],
        ...products.map((p) => [p.name, p.options.join(" / "), p.sku, p.quantity, (p.netCents / 100).toFixed(2), p.costCents === null ? "" : (p.costCents / 100).toFixed(2), p.profitCents === null ? "" : (p.profitCents / 100).toFixed(2)]),
      ])}`,
    );
  };

  const t = r?.totals;
  const delta = r && r.previous.netCents ? ((r.totals.netCents - r.previous.netCents) / r.previous.netCents) * 100 : null;
  const margin = t && t.profitCents !== null && t.netCents - t.taxCents > 0 ? (t.profitCents / (t.netCents - t.taxCents)) * 100 : null;

  return (
    <>
      <div className="nx-presets">
        <Segmented
          label="Periodo"
          value={preset}
          onChange={setPreset}
          options={[{ id: "today", label: "Hoy" }, { id: "yesterday", label: "Ayer" }, { id: "7d", label: "7 días" }, { id: "30d", label: "30 días" }, { id: "month", label: "Este mes" }, { id: "lastMonth", label: "Mes pasado" }, { id: "custom", label: "Otro" }]}
        />
        {preset === "custom" && (
          <>
            <input className="nx-input" type="date" aria-label="Desde" value={custom[0]} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
            <input className="nx-input" type="date" aria-label="Hasta" value={custom[1]} min={custom[0]} onChange={(e) => setCustom([custom[0], e.target.value])} />
          </>
        )}
        <span className="nx-muted" style={{ fontSize: 13, marginLeft: "auto" }}>{from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`}</span>
      </div>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {!r || !t ? (
        <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>
      ) : (
        <div className="nx-stack" style={{ gap: 24, opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <div className="nx-stat-grid">
            <Stat
              label="Ventas netas"
              value={money(t.netCents)}
              meta={delta === null ? "Sin periodo anterior para comparar" : <><span className={`nx-delta ${delta >= 0 ? "nx-delta--up" : "nx-delta--down"}`}>{delta >= 0 ? "↑" : "↓"} {pct(Math.abs(delta))}</span> vs. periodo anterior</>}
            />
            <Stat label="Tickets" value={t.count} meta={`Promedio ${money(t.avgTicketCents)}${t.onlineCount ? ` · ${t.onlineCount} en línea` : ""}`} />
            {t.profitCents !== null && <Stat label="Utilidad bruta" value={money(t.profitCents)} meta={margin === null ? "Ventas sin impuestos menos costo" : `Margen ${pct(margin)} · sin impuestos`} />}
            <Stat label="Descuentos" value={money(t.discountCents)} meta={`${money(t.promoDiscountCents)} en promociones y cupones`} />
          </div>
          {(t.returnsCents > 0 || t.voidedCount > 0) && (
            <p className="nx-help" style={{ margin: 0 }}>
              Incluye {t.returnsCents > 0 && <>{money(t.returnsCents)} en devoluciones</>}{t.returnsCents > 0 && t.voidedCount > 0 && " y "}{t.voidedCount > 0 && <>{t.voidedCount} {t.voidedCount === 1 ? "venta anulada" : "ventas anuladas"} (no cuentan)</>}.
            </p>
          )}

          <Card title="Ventas netas por día" description={r.days.length > 1 ? undefined : "Elige un periodo de varios días para ver la tendencia."}>
            <DayBars days={r.days} money={money} />
          </Card>

          <div className="nx-grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            <Card title="Por categoría">
              <HBars rows={r.categories.map((c) => ({ key: c.categoryId ?? "none", label: c.name, value: c.netCents, sub: c.profitCents !== null ? `Utilidad ${money(c.profitCents)}` : undefined }))} money={money} empty="Sin ventas en el periodo." />
            </Card>
            <Card title="Formas de pago" description="Efectivo neto de cambio. Incluye pedidos en línea entregados.">
              <HBars rows={r.payments.map((p) => ({ key: p.method, label: p.label, value: p.amountCents, sub: `${p.count} ${p.count === 1 ? "pago" : "pagos"}` }))} money={money} empty="Sin pagos en el periodo." />
            </Card>
          </div>

          <div className="nx-table-wrap">
            <div className="nx-table-toolbar">
              <span style={{ fontWeight: 600 }}>Productos vendidos</span>
              <Button size="sm" onClick={exportProducts} disabled={!products.length}><Download className="nx-icon" aria-hidden="true" />Exportar CSV</Button>
            </div>
            {products.length === 0 ? (
              <p className="nx-muted" style={{ padding: "8px 16px 20px", margin: 0 }}>Sin ventas en el periodo.</p>
            ) : (
              <div className="nx-table-scroll" style={{ maxHeight: 480, overflowY: "auto" }}>
                <table className="nx-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="nx-col-num" aria-sort={sort === "quantity" ? "descending" : undefined}><button type="button" className="nx-th-sort" aria-sort={sort === "quantity" ? "descending" : undefined} onClick={() => setSort("quantity")}>Cantidad</button></th>
                      <th className="nx-col-num" aria-sort={sort === "netCents" ? "descending" : undefined}><button type="button" className="nx-th-sort" aria-sort={sort === "netCents" ? "descending" : undefined} onClick={() => setSort("netCents")}>Ventas</button></th>
                      {t.profitCents !== null && <th className="nx-col-num" aria-sort={sort === "profitCents" ? "descending" : undefined}><button type="button" className="nx-th-sort" aria-sort={sort === "profitCents" ? "descending" : undefined} onClick={() => setSort("profitCents")}>Utilidad</button></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {products.slice(0, 100).map((p) => (
                      <tr key={p.variantId}>
                        <td><Link to={`/productos/${p.productId}`} style={{ color: "inherit", textDecoration: "none" }}>{p.name}</Link>{p.options.length > 0 && <span className="nx-muted"> · {p.options.join(" / ")}</span>}<div className="nx-mono nx-muted" style={{ fontSize: 12 }}>{p.sku}</div></td>
                        <td className="nx-col-num">{formatQty(p.quantity, p.unit)}</td>
                        <td className="nx-col-num" style={{ fontWeight: 500 }}>{money(p.netCents)}</td>
                        {t.profitCents !== null && <td className={`nx-col-num ${p.profitCents !== null && p.profitCents < 0 ? "nx-qty-out" : ""}`}>{money(p.profitCents)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="nx-grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            <div className="nx-table-wrap">
              <div className="nx-table-toolbar"><span style={{ fontWeight: 600 }}>Por cajero y canal</span></div>
              <table className="nx-table">
                <thead><tr><th>Quién</th><th className="nx-col-num">Ventas</th><th className="nx-col-num">Total</th><th className="nx-col-num">Descuento a mano</th></tr></thead>
                <tbody>
                  {r.cashiers.map((c) => (
                    <tr key={c.userId ?? c.name}><td>{c.name}</td><td className="nx-col-num">{c.count}</td><td className="nx-col-num">{money(c.netCents)}</td><td className="nx-col-num nx-muted">{c.discountCents ? money(c.discountCents) : "—"}</td></tr>
                  ))}
                  {r.cashiers.length === 0 && <tr><td colSpan={4} className="nx-muted">Sin ventas en el periodo.</td></tr>}
                </tbody>
              </table>
            </div>
            <Card title="Ventas en caja por hora" description="Para planear horarios y personal.">
              <HourBars hours={r.hours} money={money} />
            </Card>
          </div>

          {r.coupons.length > 0 && (
            <div className="nx-table-wrap">
              <div className="nx-table-toolbar"><span style={{ fontWeight: 600 }}>Cupones usados</span><Link className="nx-link" style={{ fontSize: 13 }} to="/promociones">Promociones</Link></div>
              <table className="nx-table">
                <thead><tr><th>Código</th><th className="nx-col-num">Usos</th><th className="nx-col-num">Ventas con el cupón</th></tr></thead>
                <tbody>{r.coupons.map((c) => <tr key={c.code}><td className="nx-mono">{c.code}</td><td className="nx-col-num">{c.uses}</td><td className="nx-col-num">{money(c.salesCents)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** One series: thin bars, 2px gaps when dense, a tooltip per bar, a label every few days. */
function DayBars({ days, money }: { days: SalesReport["days"]; money: (c: number) => string }) {
  const max = Math.max(...days.map((d) => d.netCents), 1);
  const every = days.length > 45 ? 7 : days.length > 14 ? 3 : 1;
  return (
    <figure style={{ margin: 0 }}>
      <div className={`nx-bars ${days.length > 14 ? "nx-bars--dense" : ""}`} role="img" aria-label={`Ventas por día: ${days.map((d) => `${fmtDay(d.date)} ${money(d.netCents)}`).join("; ")}`}>
        {days.map((d) => (
          <div className="nx-bars__col" key={d.date} tabIndex={0}>
            <div className="nx-bars__bar" style={{ height: `${Math.max(0, (d.netCents / max) * 100)}%` }} />
            <span className="nx-bars__tip" role="tooltip">{fmtDay(d.date)} · {money(d.netCents)} · {d.count} {d.count === 1 ? "venta" : "ventas"}</span>
          </div>
        ))}
      </div>
      <div className="nx-bars__labels" aria-hidden="true" style={days.length > 14 ? { gap: 2 } : undefined}>
        {days.map((d, i) => <span key={d.date}>{i % every === 0 ? fmtDay(d.date).replace(".", "") : ""}</span>)}
      </div>
    </figure>
  );
}

function HourBars({ hours, money }: { hours: SalesReport["hours"]; money: (c: number) => string }) {
  // Only the business's opening span, so the bars are readable.
  const used = hours.filter((h) => h.count > 0);
  if (!used.length) return <p className="nx-muted" style={{ margin: 0 }}>Sin ventas en caja en el periodo.</p>;
  const first = Math.max(0, used[0]!.hour - 1);
  const last = Math.min(23, used[used.length - 1]!.hour + 1);
  const span = hours.slice(first, last + 1);
  const max = Math.max(...span.map((h) => h.netCents), 1);
  return (
    <figure style={{ margin: 0 }}>
      <div className="nx-bars nx-bars--dense" style={{ height: 140 }} role="img" aria-label={`Ventas por hora: ${span.map((h) => `${h.hour}:00 ${money(h.netCents)}`).join("; ")}`}>
        {span.map((h) => (
          <div className="nx-bars__col" key={h.hour} tabIndex={0}>
            <div className="nx-bars__bar" style={{ height: `${(h.netCents / max) * 100}%` }} />
            <span className="nx-bars__tip" role="tooltip">{h.hour}:00–{h.hour + 1}:00 · {money(h.netCents)} · {h.count} {h.count === 1 ? "venta" : "ventas"}</span>
          </div>
        ))}
      </div>
      <div className="nx-bars__labels" aria-hidden="true" style={{ gap: 2 }}>
        {span.map((h, i) => <span key={h.hour}>{i % 2 === 0 ? `${h.hour}h` : ""}</span>)}
      </div>
    </figure>
  );
}

/** Horizontal bars for a ranking (one series, one hue). Value and secondary text in ink. */
function HBars({ rows, money, empty }: { rows: Array<{ key: string; label: string; value: number; sub?: string }>; money: (c: number) => string; empty: string }) {
  if (!rows.length) return <p className="nx-muted" style={{ margin: 0 }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="nx-hbars">
      {rows.slice(0, 8).map((r) => (
        <div className="nx-hbar" key={r.key} title={`${r.label}: ${money(r.value)} (${total ? pct((r.value / total) * 100) : "0 %"})`}>
          <span className="nx-hbar__label">{r.label}</span>
          <div className="nx-hbar__track" aria-hidden="true"><div className="nx-hbar__fill" style={{ width: `${Math.max(0, (r.value / max) * 100)}%` }} /></div>
          <span className="nx-hbar__value">{money(r.value)}{r.sub && <small>{r.sub}</small>}</span>
        </div>
      ))}
    </div>
  );
}

function InventoryTab() {
  const { money } = useBusiness();
  const [days, setDays] = useState<"30" | "60" | "90">("60");
  const { data: r, error } = useLoad(() => get<InventoryReport>(`/reports/inventory?days=${days}`), [days]);
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!r) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const staleValue = r.stale.reduce((a, s) => a + s.costCents, 0);
  return (
    <div className="nx-stack" style={{ gap: 24 }}>
      <div className="nx-stat-grid">
        <Stat label="Inventario a costo" value={money(r.totalCostCents)} meta="Costo promedio × existencias" />
        <Stat label="A precio de venta" value={money(r.totalRetailCents)} meta={r.totalRetailCents ? `Margen potencial ${pct(((r.totalRetailCents - r.totalCostCents) / r.totalRetailCents) * 100)}` : undefined} />
        <Stat label="Sin movimiento" value={money(staleValue)} meta={`${r.stale.length} ${r.stale.length === 1 ? "producto" : "productos"} sin vender en ${r.days} días`} />
      </div>
      <Card title="Valor del inventario por categoría" description="A costo.">
        <HBars rows={r.valuation.map((v) => ({ key: v.categoryId ?? "none", label: v.name, value: v.costCents, sub: `A la venta ${money(v.retailCents)}` }))} money={money} empty="No hay existencias." />
      </Card>
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <span style={{ fontWeight: 600 }}>Productos sin vender</span>
          <Segmented label="Días sin venta" value={days} onChange={setDays} options={[{ id: "30", label: "30 días" }, { id: "60", label: "60 días" }, { id: "90", label: "90 días" }]} />
        </div>
        {r.stale.length === 0 ? (
          <p className="nx-muted" style={{ padding: "8px 16px 20px", margin: 0 }}>Todo lo que tienes en existencia se ha vendido en los últimos {r.days} días.</p>
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead><tr><th>Producto</th><th className="nx-col-num">Existencia</th><th className="nx-col-num">Valor a costo</th><th>Última venta</th></tr></thead>
              <tbody>
                {r.stale.map((s) => (
                  <tr key={s.variantId}>
                    <td><Link to={`/productos/${s.productId}`} style={{ color: "inherit", textDecoration: "none" }}>{s.name}</Link>{s.options.length > 0 && <span className="nx-muted"> · {s.options.join(" / ")}</span>}</td>
                    <td className="nx-col-num">{formatQty(s.stock, s.unit)}</td>
                    <td className="nx-col-num" style={{ fontWeight: 500 }}>{money(s.costCents)}</td>
                    <td className="nx-muted">{s.lastSaleAt ? dateFmt.format(new Date(s.lastSaleAt)) : "Nunca"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="nx-help" style={{ margin: 0 }}>Considera una promoción para los productos sin movimiento: libera efectivo y espacio.</p>
    </div>
  );
}
