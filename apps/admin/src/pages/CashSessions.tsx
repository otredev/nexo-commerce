import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Wallet } from "lucide-react";
import { paymentLabel, type CashSession } from "@nexo/shared";
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from "@nexo/ui";
import { get } from "../lib/api";
import { useBusiness } from "../lib/business";
import { useLoad } from "../lib/hooks";

const timeFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

interface SessionRow {
  id: string; status: "open" | "closed"; openedAt: string; openedBy: string | null; closedAt: string | null; closedBy: string | null; locationName: string | null;
  openingCashCents: number; countedCashCents: number | null; expectedCashCents: number | null; differenceCents: number | null; salesCount: number | null; salesTotalCents: number | null;
}

function Difference({ cents, money }: { cents: number | null; money: (c: number) => string }) {
  if (cents === null) return <span className="nx-muted">—</span>;
  if (cents === 0) return <Badge tone="success">Cuadra</Badge>;
  return <Badge tone={cents < 0 ? "danger" : "warning"}>{cents < 0 ? `Faltan ${money(-cents)}` : `Sobran ${money(cents)}`}</Badge>;
}

export function CashSessionsPage() {
  const { money } = useBusiness();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => get<{ items: SessionRow[] }>("/cash/sessions"));
  return (
    <>
      <PageHeader title="Cortes de caja" description="Cada turno de caja: fondo inicial, ventas, retiros y diferencias al cerrar." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="nx-table-wrap">
        {data && data.items.length === 0 ? (
          <EmptyState icon={<Wallet className="nx-icon" />} title="Aún no hay cortes" text="Abre la caja desde el punto de venta para empezar un turno." actions={<Button variant="primary" onClick={() => navigate("/pos")}>Abrir punto de venta</Button>} />
        ) : (
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead><tr><th>Apertura</th><th>Ubicación</th><th>Responsable</th><th>Estado</th><th className="nx-col-num">Ventas</th><th className="nx-col-num">Efectivo contado</th><th>Diferencia</th></tr></thead>
              <tbody>
                {data?.items.map((s) => (
                  <tr key={s.id} className="nx-clickable" onClick={() => navigate(`/caja/${s.id}`)}>
                    <td className="nx-num" style={{ whiteSpace: "nowrap" }}>{timeFmt.format(new Date(s.openedAt))}</td>
                    <td className="nx-muted">{s.locationName}</td>
                    <td className="nx-muted">{s.openedBy}{s.closedBy && s.closedBy !== s.openedBy && ` → ${s.closedBy}`}</td>
                    <td>{s.status === "open" ? <Badge tone="info">Abierta</Badge> : <Badge plain>Cerrada</Badge>}</td>
                    <td className="nx-col-num">{s.salesTotalCents !== null ? `${s.salesCount} · ${money(s.salesTotalCents)}` : "—"}</td>
                    <td className="nx-col-num">{s.countedCashCents !== null ? money(s.countedCashCents) : "—"}</td>
                    <td><Difference cents={s.differenceCents} money={money} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export function CashSessionPage() {
  const { id } = useParams();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const { data: s, error } = useLoad(() => get<CashSession>(`/cash/sessions/${id}`), [id]);
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!s) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const t = s.totals;
  return (
    <>
      <div><Link className="nx-link" to="/caja" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}><ArrowLeft size={14} aria-hidden="true" />Cortes de caja</Link></div>
      <PageHeader
        title={`Corte · ${s.locationName}`}
        description={`${timeFmt.format(new Date(s.openedAt))}${s.closedAt ? ` — ${timeFmt.format(new Date(s.closedAt))}` : " · abierta"}`}
        actions={<Button onClick={() => navigate(`/ventas?sesion=${s.id}`)}>Ver ventas del turno</Button>}
      />
      <div className="nx-grid-2">
        <Card title="Efectivo">
          <dl className="nx-kv">
            <div><dt>Fondo inicial</dt><dd>{money(s.openingCashCents)}</dd></div>
            {t && s.expectedCashCents !== null && <div><dt>Ventas en efectivo (neto de cambio)</dt><dd>{money(t.cashSalesCents)}</dd></div>}
            {t && <div><dt>Ingresos</dt><dd>{money(t.cashInCents)}</dd></div>}
            {t && <div><dt>Retiros</dt><dd>−{money(t.cashOutCents)}</dd></div>}
            {t && t.cashRefundsCents > 0 && <div><dt>Reembolsos en efectivo</dt><dd>−{money(t.cashRefundsCents)}</dd></div>}
            {s.expectedCashCents !== null && <div><dt style={{ color: "var(--ink)", fontWeight: 600 }}>Efectivo esperado</dt><dd>{money(s.expectedCashCents)}</dd></div>}
            {s.countedCashCents !== null && <div><dt style={{ color: "var(--ink)", fontWeight: 600 }}>Efectivo contado</dt><dd>{money(s.countedCashCents)}</dd></div>}
            {s.status === "closed" && <div><dt>Diferencia</dt><dd><Difference cents={s.differenceCents} money={money} /></dd></div>}
          </dl>
          {s.status === "open" && s.expectedCashCents === null && <p className="nx-help" style={{ marginTop: 12 }}>El efectivo esperado se muestra al cerrar la caja (cierre ciego).</p>}
        </Card>
        <Card title="Ventas del turno">
          <dl className="nx-kv">
            <div><dt>Ventas</dt><dd>{t?.salesCount ?? 0}</dd></div>
            <div><dt>Total vendido</dt><dd>{money(t?.salesTotalCents ?? 0)}</dd></div>
            {t && s.expectedCashCents !== null && Object.entries(t.byMethod).map(([m, v]) => <div key={m}><dt>{paymentLabel(m)}</dt><dd>{money(v)}</dd></div>)}
          </dl>
        </Card>
      </div>
      {s.movements.length > 0 && (
        <div className="nx-table-wrap">
          <div className="nx-table-toolbar"><span style={{ fontWeight: 600 }}>Ingresos y retiros</span></div>
          <table className="nx-table">
            <thead><tr><th>Hora</th><th>Tipo</th><th>Motivo</th><th>Usuario</th><th className="nx-col-num">Importe</th></tr></thead>
            <tbody>
              {s.movements.map((m) => (
                <tr key={m.id}>
                  <td className="nx-muted nx-num">{timeFmt.format(new Date(m.createdAt))}</td>
                  <td>{m.type === "in" ? "Ingreso" : "Retiro"}</td>
                  <td>{m.reason}</td>
                  <td className="nx-muted">{m.userName}</td>
                  <td className={`nx-col-num ${m.type === "in" ? "nx-qty-in" : "nx-qty-out"}`}>{m.type === "in" ? "+" : "−"}{money(m.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.note && <Alert tone="info">{s.note}</Alert>}
    </>
  );
}
