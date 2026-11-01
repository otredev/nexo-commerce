import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer, RotateCcw, Send, XCircle } from "lucide-react";
import { formatFolio, formatQty, PAYMENT_METHODS, paymentLabel, VOID_REASONS, type SaleDetail } from "@nexo/shared";
import { Alert, Badge, Button, Card, Checkbox, Modal, PageHeader, SelectField, TextField, useToast } from "@nexo/ui";
import { get, post, RequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";
import { useLoad, useSubmit } from "../lib/hooks";

const timeFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short" });

export function SaleDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { money } = useBusiness();
  const toast = useToast();
  const { data: sale, error, setData } = useLoad(() => get<SaleDetail>(`/sales/${id}`), [id]);
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [email, setEmail] = useState("");
  const send = useSubmit(async () => {
    await post(`/sales/${id}/email`, { email });
    toast(`Recibo enviado a ${email}`);
    setEmailing(false);
  });

  if (error) return <Alert tone="danger">{error.status === 404 ? "Esta venta no existe." : error.message}</Alert>;
  if (!sale) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const returnable = sale.status === "completed" && sale.items.some((i) => i.returnedQuantity < i.quantity);

  return (
    <>
      <div><Link className="nx-link" to="/ventas" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}><ArrowLeft size={14} aria-hidden="true" />Ventas</Link></div>
      <PageHeader
        title={`Venta ${formatFolio(sale.number)}`}
        description={
          <span className="nx-row" style={{ gap: 8 }}>
            {sale.status === "voided" ? <Badge tone="danger">Anulada</Badge> : sale.refundedCents > 0 ? <Badge tone="warning">Con devoluciones</Badge> : <Badge tone="success">Completada</Badge>}
            <span>{timeFmt.format(new Date(sale.createdAt))} · {sale.locationName} · {sale.userName}</span>
          </span>
        }
        actions={
          <>
            <Button onClick={() => window.open(`/recibo/${sale.id}?imprimir=1`, "recibo", "width=420,height=720")}><Printer className="nx-icon" aria-hidden="true" />Imprimir</Button>
            <Button onClick={() => { setEmail(sale.customerContact?.includes("@") ? sale.customerContact : ""); setEmailing(true); }}><Send className="nx-icon" aria-hidden="true" />Enviar</Button>
            {can("sales:return") && returnable && <Button onClick={() => setReturning(true)}><RotateCcw className="nx-icon" aria-hidden="true" />Devolución</Button>}
            {can("sales:void") && sale.voidable && <Button variant="danger-ghost" onClick={() => setVoiding(true)}><XCircle className="nx-icon" aria-hidden="true" />Anular</Button>}
          </>
        }
      />
      {sale.status === "voided" && <Alert tone="danger" title={`Anulada por ${sale.voidedBy ?? "—"}`}>{sale.voidReason}. Las existencias regresaron al inventario.</Alert>}
      <div className="nx-grid-2">
        <div className="nx-table-wrap">
          <table className="nx-table">
            <thead><tr><th>Producto</th><th className="nx-col-num">Cantidad</th><th className="nx-col-num">Precio</th><th className="nx-col-num">Descuento</th><th className="nx-col-num">Total</th></tr></thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={`/productos/${i.productId}`} style={{ color: "inherit", textDecoration: "none" }}>{i.name}{i.options.length > 0 && <span className="nx-muted"> · {i.options.join(" / ")}</span>}</Link>
                    <div className="nx-mono nx-muted">{i.sku}</div>
                    {i.returnedQuantity > 0 && <div style={{ fontSize: 12, color: "var(--warning)" }}>Devuelto: {formatQty(i.returnedQuantity, i.unit)}</div>}
                  </td>
                  <td className="nx-col-num">{formatQty(i.quantity, i.unit)}</td>
                  <td className="nx-col-num">{money(i.unitPriceCents)}</td>
                  <td className="nx-col-num nx-muted">{i.discountCents ? `−${money(i.discountCents)}` : "—"}</td>
                  <td className="nx-col-num" style={{ fontWeight: 500 }}>{money(i.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Resumen">
            <dl className="nx-kv">
              <div><dt>Subtotal</dt><dd>{money(sale.subtotalCents)}</dd></div>
              {sale.promoDiscountCents > 0 && <div><dt>Promociones{sale.couponCode && ` y cupón ${sale.couponCode}`}</dt><dd>−{money(sale.promoDiscountCents)}</dd></div>}
              {sale.discountCents - sale.promoDiscountCents > 0 && <div><dt>Descuento</dt><dd>−{money(sale.discountCents - sale.promoDiscountCents)}</dd></div>}
              <div><dt>Impuestos{sale.pricesIncludeTax ? " incluidos" : ""}</dt><dd>{money(sale.taxCents)}</dd></div>
              <div><dt style={{ color: "var(--ink)", fontWeight: 600 }}>Total</dt><dd style={{ fontSize: 18 }}>{money(sale.totalCents)}</dd></div>
              {sale.payments.map((p, i) => <div key={i}><dt>{paymentLabel(p.method)}{p.reference && ` · ${p.reference}`}</dt><dd>{money(p.amountCents)}</dd></div>)}
              {sale.changeCents > 0 && <div><dt>Cambio</dt><dd>{money(sale.changeCents)}</dd></div>}
              {sale.refundedCents > 0 && <div><dt>Devuelto</dt><dd className="nx-qty-out">−{money(sale.refundedCents)}</dd></div>}
            </dl>
          </Card>
          {(sale.customerName || sale.customerContact || sale.note) && (
            <Card title="Cliente">
              <dl className="nx-kv">
                {sale.customerName && <div><dt>Nombre</dt><dd>{sale.customerId ? <Link className="nx-link" to={`/clientes/${sale.customerId}`}>{sale.customerName}</Link> : sale.customerName}</dd></div>}
                {sale.customerContact && <div><dt>Contacto</dt><dd>{sale.customerContact}</dd></div>}
                {sale.note && <div><dt>Nota</dt><dd>{sale.note}</dd></div>}
              </dl>
            </Card>
          )}
          {sale.returns.length > 0 && (
            <Card title="Devoluciones">
              <div className="nx-stack" style={{ gap: 12 }}>
                {sale.returns.map((r) => (
                  <div key={r.id} style={{ fontSize: 13 }}>
                    <div className="nx-row" style={{ justifyContent: "space-between" }}><strong>{money(r.refundCents)}</strong><span className="nx-muted">{timeFmt.format(new Date(r.createdAt))}</span></div>
                    <div className="nx-muted">{paymentLabel(r.refundMethod)} · {r.restock ? "regresó al inventario" : "no regresó al inventario"} · {r.userName}</div>
                    <div>{r.reason}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
      <VoidModal open={voiding} sale={sale} onClose={() => setVoiding(false)} onDone={(s) => { setData(s); setVoiding(false); toast("Venta anulada"); }} />
      <ReturnModal open={returning} sale={sale} onClose={() => setReturning(false)} onDone={(s) => { setData(s); setReturning(false); toast("Devolución registrada"); }} />
      <Modal open={emailing} title="Enviar recibo" onClose={() => setEmailing(false)} footer={<><Button variant="ghost" onClick={() => setEmailing(false)}>Cancelar</Button><Button variant="primary" loading={send.pending} onClick={() => void send.submit()}>Enviar</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void send.submit(); }}>
          <TextField label="Correo del cliente" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={send.fields.email ?? send.message ?? undefined} autoFocus />
        </form>
      </Modal>
    </>
  );
}

function VoidModal({ open, sale, onClose, onDone }: { open: boolean; sale: SaleDetail; onClose: () => void; onDone: (s: SaleDetail) => void }) {
  const { money } = useBusiness();
  const [reason, setReason] = useState<string>(VOID_REASONS[0]);
  const [other, setOther] = useState("");
  const save = useSubmit(async () => onDone(await post<SaleDetail>(`/sales/${sale.id}/void`, { reason: reason === "Otro" ? other || "Otro" : reason })));
  return (
    <Modal open={open} title={`¿Anular la venta ${formatFolio(sale.number)}?`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={save.pending} onClick={() => void save.submit()}>Anular venta</Button></>}>
      <div className="nx-stack">
        <p style={{ margin: 0 }}>La venta por {money(sale.totalCents)} se anulará, sus productos volverán al inventario y dejará de contar en el corte de caja. Devuelve el dinero al cliente por el mismo medio.</p>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <SelectField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)}>
          {VOID_REASONS.map((r) => <option key={r}>{r}</option>)}
        </SelectField>
        {reason === "Otro" && <TextField label="Describe el motivo" value={other} onChange={(e) => setOther(e.target.value)} />}
      </div>
    </Modal>
  );
}

function ReturnModal({ open, sale, onClose, onDone }: { open: boolean; sale: SaleDetail; onClose: () => void; onDone: (s: SaleDetail) => void }) {
  const { money, locations } = useBusiness();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("cash");
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState(sale.locationId);
  useEffect(() => { if (open) { setQty({}); setMethod(sale.payments[0]?.method ?? "cash"); setRestock(true); setReason(""); setLocationId(sale.locationId); } }, [open, sale]);
  const items = sale.items.map((i) => {
    const max = +(i.quantity - i.returnedQuantity).toFixed(3);
    const n = Number((qty[i.id] ?? "").replace(",", "."));
    const q = Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
    return { item: i, max, q, refund: q === max ? null : Math.round((i.totalCents * q) / i.quantity) };
  });
  const estimate = items.reduce((a, x) => a + (x.q ? (x.refund ?? Math.round((x.item.totalCents * x.q) / x.item.quantity)) : 0), 0);
  const save = useSubmit(async () => {
    const chosen = items.filter((x) => x.q > 0).map((x) => ({ saleItemId: x.item.id, quantity: x.q }));
    if (!chosen.length) throw new RequestError(422, "validation_error", "Indica cuántas unidades se devuelven");
    onDone(await post<SaleDetail>(`/sales/${sale.id}/returns`, { items: chosen, refundMethod: method, restock, reason, locationId }));
  });
  return (
    <Modal open={open} size="lg" title="Registrar devolución" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Reembolsar {money(estimate)}</Button></>}>
      <div className="nx-stack">
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <div className="nx-table-wrap" style={{ boxShadow: "none" }}>
          <table className="nx-table nx-table--form">
            <thead><tr><th>Producto</th><th className="nx-col-num">Vendido</th><th className="nx-col-num">Devolver</th></tr></thead>
            <tbody>
              {items.map(({ item, max }) => (
                <tr key={item.id}>
                  <td>{item.name}{item.options.length > 0 && <span className="nx-muted"> · {item.options.join(" / ")}</span>}</td>
                  <td className="nx-col-num nx-muted">{formatQty(item.quantity, item.unit)}{item.returnedQuantity > 0 && ` (ya ${formatQty(item.returnedQuantity, item.unit)})`}</td>
                  <td className="nx-col-num">
                    {max > 0 ? (
                      <span className="nx-row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <input className="nx-input nx-num" style={{ width: 80, textAlign: "right" }} inputMode="decimal" aria-label={`Devolver de ${item.name}`} placeholder="0" value={qty[item.id] ?? ""} onChange={(e) => setQty({ ...qty, [item.id]: e.target.value })} />
                        <Button size="sm" variant="ghost" onClick={() => setQty({ ...qty, [item.id]: String(max) })}>Todo</Button>
                      </span>
                    ) : <span className="nx-muted">Devuelto</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="nx-form-grid">
          <SelectField label="Reembolso" value={method} onChange={(e) => setMethod(e.target.value)} help={method === "cash" ? "Sale de la caja abierta de la ubicación." : undefined}>
            {PAYMENT_METHODS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </SelectField>
          {locations.length > 1 && (
            <SelectField label="Ubicación que recibe" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SelectField>
          )}
          <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} error={save.fields.reason} placeholder="Talla equivocada, defecto de fábrica…" fieldClassName="nx-span-2" />
          <div className="nx-span-2"><Checkbox label="Regresar los productos al inventario" help="Desmárcalo si llegaron dañados y no se pueden vender." checked={restock} onChange={(e) => setRestock(e.target.checked)} /></div>
        </div>
      </div>
    </Modal>
  );
}
