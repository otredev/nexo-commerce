import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Receipt } from "lucide-react";
import { docNumber, parseMoney, PAYMENT_METHODS, paymentLabel, type Payable, type PayablesSummary, type PaymentMethod, type Supplier } from "@nexo/shared";
import { Alert, Badge, Button, Checkbox, EmptyState, Modal, PageHeader, Segmented, SelectField, Stat, TextField, useToast } from "@nexo/ui";
import { get, post, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { centsToInput, useBusiness } from "../lib/business";
import { useLoad, useSubmit } from "../lib/hooks";
import { formatDay } from "../components/docs";

type Filter = "open" | "overdue" | "paid" | "all";

function DueBadge({ p }: { p: Payable }) {
  if (p.balanceCents === 0) return <Badge tone="success">Pagada</Badge>;
  if (p.daysToDue === null) return <Badge plain>Sin vencimiento</Badge>;
  if (p.daysToDue < 0) return <Badge tone="danger">Vencida hace {-p.daysToDue} {p.daysToDue === -1 ? "día" : "días"}</Badge>;
  if (p.daysToDue === 0) return <Badge tone="warning">Vence hoy</Badge>;
  if (p.daysToDue <= 7) return <Badge tone="warning">Vence en {p.daysToDue} {p.daysToDue === 1 ? "día" : "días"}</Badge>;
  return <Badge plain>En {p.daysToDue} días</Badge>;
}

export function PayablesPage() {
  const { can } = useAuth();
  const { money } = useBusiness();
  const [params, setParams] = useSearchParams();
  const status = (params.get("estado") ?? "open") as Filter;
  const supplierId = params.get("proveedor") ?? "";
  const [paying, setPaying] = useState<Payable | null>(null);
  const search = new URLSearchParams({ status, ...(supplierId && { supplierId }) });
  const { data, error, loading, reload } = useLoad(() => get<{ items: Payable[]; summary: PayablesSummary; today: string }>(`/payables?${search}`), [search.toString()]);
  const suppliers = useLoad(() => get<Supplier[]>("/suppliers?status=all"));
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const s = data?.summary;

  return (
    <>
      <PageHeader title="Cuentas por pagar" description="Facturas de tus proveedores: lo que debes, cuándo vence y lo que ya pagaste." />
      {error && <Alert tone="danger">{error.message}</Alert>}
      {s && (
        <div className="nx-stat-grid">
          <Stat label="Por pagar" value={money(s.openCents)} meta={`${s.bySupplier.length} ${s.bySupplier.length === 1 ? "proveedor" : "proveedores"}`} />
          <Stat label="Vencido" value={money(s.overdueCents)} meta={s.overdueCents ? <button type="button" className="nx-link" style={{ border: 0, background: "none", padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => set("estado", "overdue")}>Ver facturas vencidas</button> : "Al corriente"} />
          <Stat label="Vence en 7 días" value={money(s.dueSoonCents)} />
          {s.bySupplier[0] && <Stat label="Mayor saldo" value={money(s.bySupplier[0].balanceCents)} meta={s.bySupplier[0].supplierName} />}
        </div>
      )}
      <div className="nx-table-wrap">
        <div className="nx-table-toolbar">
          <div className="nx-filters">
            <select className="nx-select" aria-label="Proveedor" value={supplierId} onChange={(e) => set("proveedor", e.target.value)}>
              <option value="">Todos los proveedores</option>
              {suppliers.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <Segmented label="Estado" value={status} onChange={(v) => set("estado", v === "open" ? "" : v)} options={[{ id: "open", label: "Por pagar" }, { id: "overdue", label: "Vencidas" }, { id: "paid", label: "Pagadas" }, { id: "all", label: "Todas" }]} />
        </div>
        {data && data.items.length === 0 ? (
          <EmptyState
            icon={<Receipt className="nx-icon" />}
            title={status === "open" ? "No debes nada" : "Ninguna factura coincide"}
            text={status === "open" ? "Cada recepción de una orden de compra crea aquí la factura del proveedor con su fecha de vencimiento." : undefined}
          />
        ) : (
          <div className="nx-table-scroll" aria-busy={loading}>
            <table className="nx-table">
              <thead><tr><th>Proveedor</th><th>Factura</th><th>Recibida</th><th>Vencimiento</th><th className="nx-col-num">Total</th><th className="nx-col-num">Pagado</th><th className="nx-col-num">Saldo</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {data?.items.map((p) => (
                  <tr key={p.receiptId}>
                    <td style={{ fontWeight: 500 }}>{p.supplierName}</td>
                    <td>
                      {p.supplierReference ?? <span className="nx-muted">Sin número</span>}
                      <div style={{ fontSize: 12 }}><Link className="nx-link" to={`/compras/${p.orderId}`}>{docNumber("purchase", p.orderNumber)}</Link></div>
                    </td>
                    <td className="nx-muted nx-num" style={{ whiteSpace: "nowrap" }}>{formatDay(p.receivedAt.slice(0, 10))}</td>
                    <td style={{ whiteSpace: "nowrap" }}><div className="nx-num" style={{ fontSize: 13 }}>{formatDay(p.dueDate)}</div><DueBadge p={p} /></td>
                    <td className="nx-col-num">{money(p.amountDueCents)}</td>
                    <td className="nx-col-num nx-muted">{p.paidCents ? money(p.paidCents) : "—"}</td>
                    <td className="nx-col-num" style={{ fontWeight: 600 }}>{money(p.balanceCents)}</td>
                    <td style={{ textAlign: "right" }}>
                      {can("payables:write") && p.balanceCents > 0 ? <Button size="sm" onClick={() => setPaying(p)}>Pagar</Button> : p.payments.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setPaying(p)}>Pagos</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <PayModal payable={paying} today={data?.today ?? ""} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void reload(); }} />
    </>
  );
}

function PayModal({ payable, today, onClose, onDone }: { payable: Payable | null; today: string; onClose: () => void; onDone: () => void }) {
  const { money } = useBusiness();
  const { can } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [fromDrawer, setFromDrawer] = useState(false);
  useEffect(() => {
    if (!payable) return;
    setAmount(centsToInput(payable.balanceCents));
    setMethod("transfer");
    setReference("");
    setPaidOn(today);
    setFromDrawer(false);
  }, [payable, today]);
  const save = useSubmit(async () => {
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) throw new RequestError(422, "validation_error", "Revisa", { amountCents: "Importe no válido" });
    const r = await post<{ balanceCents: number }>(`/payables/${payable!.receiptId}/payments`, { amountCents: cents, method, reference: reference || null, paidOn, note: null, fromCashDrawer: method === "cash" && fromDrawer });
    toast(r.balanceCents === 0 ? "Factura liquidada" : `Pago registrado. Saldo: ${money(r.balanceCents)}`);
    onDone();
  });
  if (!payable) return null;
  const canPay = can("payables:write") && payable.balanceCents > 0;
  return (
    <Modal
      open
      title={`${payable.supplierName}${payable.supplierReference ? ` · ${payable.supplierReference}` : ""}`}
      onClose={onClose}
      footer={canPay ? <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Registrar pago</Button></> : <Button onClick={onClose}>Cerrar</Button>}
    >
      <div className="nx-stack">
        <dl className="nx-kv">
          <div><dt>Total de la factura</dt><dd>{money(payable.amountDueCents)}</dd></div>
          <div><dt>Pagado</dt><dd>{money(payable.paidCents)}</dd></div>
          <div><dt style={{ color: "var(--ink)", fontWeight: 600 }}>Saldo</dt><dd style={{ fontWeight: 600 }}>{money(payable.balanceCents)}</dd></div>
        </dl>
        {payable.payments.length > 0 && (
          <div style={{ fontSize: 13 }}>
            <div className="nx-label" style={{ marginBottom: 6 }}>Pagos</div>
            {payable.payments.map((x) => (
              <div key={x.id} className="nx-row" style={{ justifyContent: "space-between", padding: "4px 0" }}>
                <span>{formatDay(x.paidOn)} · {paymentLabel(x.method)}{x.reference && ` · ${x.reference}`}</span>
                <span className="nx-num">{money(x.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
        {canPay && (
          <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
            {save.message && <Alert tone="danger">{save.message}</Alert>}
            <div className="nx-form-grid">
              <TextField label="Importe" inputMode="decimal" className="nx-num" value={amount} onChange={(e) => setAmount(e.target.value)} error={save.fields.amountCents} help="Puedes pagar una parte." autoFocus />
              <TextField label="Fecha de pago" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} error={save.fields.paidOn} />
              <SelectField label="Forma de pago" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} error={save.fields.method}>
                {PAYMENT_METHODS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </SelectField>
              <TextField label="Referencia" optional value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Folio SPEI, cheque…" />
            </div>
            {method === "cash" && <Checkbox label="Sacar el efectivo de la caja abierta" help="Se registra como retiro en el corte de la ubicación que recibió la mercancía." checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} />}
          </form>
        )}
      </div>
    </Modal>
  );
}
