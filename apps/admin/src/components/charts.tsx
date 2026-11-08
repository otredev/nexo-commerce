/**
 * Small, dependency-free charts shared by the reports (one series, one hue, tooltips per mark).
 * Text stays in ink colors; the bar carries identity, never a number alone.
 */
import type { ReactNode } from "react";

const dayFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
export const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
export const pct = (n: number) => `${n.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;

/** Vertical bars by day. `tip` is the tooltip text of each bar. */
export function DayBars({ points, label, height = 160, labelOf }: { points: Array<{ date: string; value: number; tip: string }>; label: string; height?: number; labelOf?: (date: string) => string }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const dense = points.length > 14;
  const every = points.length > 45 ? 7 : dense ? 3 : 1;
  return (
    <figure style={{ margin: 0 }}>
      <div className={`nx-bars ${dense ? "nx-bars--dense" : ""}`} style={{ height }} role="img" aria-label={`${label}: ${points.map((p) => p.tip).join("; ")}`}>
        {points.map((p) => (
          <div className="nx-bars__col" key={p.date} tabIndex={0}>
            <div className="nx-bars__bar" style={{ height: `${Math.max(0, (p.value / max) * 100)}%` }} />
            <span className="nx-bars__tip" role="tooltip">{p.tip}</span>
          </div>
        ))}
      </div>
      <div className="nx-bars__labels" aria-hidden="true" style={dense ? { gap: 2 } : undefined}>
        {points.map((p, i) => <span key={p.date}>{i % every === 0 ? (labelOf ? labelOf(p.date) : fmtDay(p.date).replace(".", "")) : ""}</span>)}
      </div>
    </figure>
  );
}

/** Horizontal bars for a ranking. */
export function HBars({ rows, format, empty, limit = 8 }: { rows: Array<{ key: string; label: ReactNode; value: number; sub?: string }>; format: (v: number) => string; empty: string; limit?: number }) {
  if (!rows.length) return <p className="nx-muted" style={{ margin: 0 }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="nx-hbars">
      {rows.slice(0, limit).map((r) => (
        <div className="nx-hbar" key={r.key} title={`${typeof r.label === "string" ? r.label : r.key}: ${format(r.value)} (${total ? pct((r.value / total) * 100) : "0 %"})`}>
          <span className="nx-hbar__label">{r.label}</span>
          <div className="nx-hbar__track" aria-hidden="true"><div className="nx-hbar__fill" style={{ width: `${Math.max(0, (r.value / max) * 100)}%` }} /></div>
          <span className="nx-hbar__value">{format(r.value)}{r.sub && <small>{r.sub}</small>}</span>
        </div>
      ))}
    </div>
  );
}

/** Change against the previous period, colored by direction. */
export function Delta({ value, suffix = "vs. periodo anterior", points }: { value: number | null; suffix?: string; points?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <>Sin periodo anterior para comparar</>;
  const up = value >= 0;
  return (
    <>
      <span className={`nx-delta ${up ? "nx-delta--up" : "nx-delta--down"}`}>{up ? "↑" : "↓"} {points ? `${Math.abs(value).toLocaleString("es-MX", { maximumFractionDigits: 1 })} pts` : pct(Math.abs(value))}</span> {suffix}
    </>
  );
}
