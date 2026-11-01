import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Copy, Mail, MessageCircle, PackageCheck, Phone, Truck, XCircle } from "lucide-react";
import { FULFILLMENT_LABELS, formatQty, ONLINE_PAYMENT_LABELS, PAYMENT_METHODS, paymentLabel, type OrderDetail, type PaymentMethod } from "@nexo/shared";
import { Alert, Button, Card, Modal, PageHeader, SelectField, TextField, useToast } from "@nexo/ui";
import { get, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { BackLink, dateTimeFmt, Steps } from "../../components/docs";
import { OrderStatusBadge, orderLabel, PaymentBadge, whatsappTo } from "../../components/orders";
import { Thumb } from "../../components/StockBadge";

export function OrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { money } = useBusiness();
  const toast = useToast();
  const { data: o, error, setData } = useLoad(() => get<OrderDetail>(`/orders/${id}`), [id]);
  const [paying, setPaying] = useState<"pay" | "complete" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const act = useSubmit(async (action: "confirm" | "ready" | "complete") => {
    const updated = await post<OrderDetail>(`/orders/${id}/${action}`, action === "complete" ? { payment: null } : undefined);
    setData(updated);
    toast({ confirm: "Pedido aceptado. Avisamos al cliente.", ready: updated.fulfillment === "pickup" ? "Listo para recoger. Avisamos al cliente." : "En camino. Avisamos al cliente.", complete: "Pedido entregado" }[action]);
  });

  if (error) return <Alert tone="danger">{error.status === 404 ? "Este pedido no existe." : error.message}</Alert>;
  if (!o) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const open = o.status !== "completed" && o.status !== "cancelled";
  const fulfill = can("orders:fulfill");
  const step = { pending: 0, confirmed: 1, ready: 2, completed: 4, cancelled: 0 }[o.status];
  const readyLabel = o.fulfillment === "pickup" ? "Listo para recoger" : "En camino";
  const greeting = `Hola ${o.customerName.split(" ")[0]}, te escribimos de la tienda por tu pedido ${orderLabel(o.number)}.`;
  const deliver = () => (o.paymentStatus === "paid" ? void act.submit("complete") : setPaying("complete"));

  return (
    <>
      <BackLink to="/pedidos">Pedidos en línea</BackLink>
      <PageHeader
        title={`Pedido ${orderLabel(o.number)}`}
        description={
          <span className="nx-row" style={{ gap: 8 }}>
            <OrderStatusBadge status={o.status} fulfillment={o.fulfillment} />
            <PaymentBadge status={o.paymentStatus} />
            <span>{dateTimeFmt.format(new Date(o.createdAt))} · {FULFILLMENT_LABELS[o.fulfillment]}</span>
          </span>
        }
        actions={
          <>
            {can("orders:cancel") && open && <Button variant="danger-ghost" onClick={() => setCancelling(true)}><XCircle className="nx-icon" aria-hidden="true" />Cancelar</Button>}
            {fulfill && open && o.paymentStatus === "pending" && <Button onClick={() => setPaying("pay")}>Registrar pago</Button>}
            {fulfill && o.status === "pending" && <Button variant="primary" loading={act.pending} onClick={() => void act.submit("confirm")}><Check className="nx-icon" aria-hidden="true" />Aceptar pedido</Button>}
            {fulfill && o.status === "confirmed" && <Button variant="primary" loading={act.pending} onClick={() => void act.submit("ready")}>{o.fulfillment === "pickup" ? <PackageCheck className="nx-icon" aria-hidden="true" /> : <Truck className="nx-icon" aria-hidden="true" />}{readyLabel}</Button>}
            {fulfill && o.status === "ready" && <Button variant="primary" loading={act.pending} onClick={deliver}><Check className="nx-icon" aria-hidden="true" />Entregado</Button>}
          </>
        }
      />
      {act.message && <Alert tone="danger">{act.message}</Alert>}
      {o.status === "cancelled" ? (
        <Alert tone="danger" title={o.cancelledBy === "customer" ? "El cliente canceló el pedido" : o.cancelledBy === "system" ? "Se canceló solo por no confirmarse a tiempo" : "Pedido cancelado"}>
          {o.cancelReason}{o.cancelledAt && ` · ${dateTimeFmt.format(new Date(o.cancelledAt))}`}. Las existencias regresaron al inventario.
          {o.paymentStatus === "paid" && <div><strong>Ya estaba pagado ({money(o.totalCents)}): devuelve el dinero al cliente.</strong></div>}
        </Alert>
      ) : (
        <Steps steps={["Nuevo", "Aceptado", readyLabel, "Entregado"]} current={step} />
      )}
      {o.status === "pending" && <Alert tone="warning">Pedido nuevo: acéptalo para avisarle al cliente que lo estás preparando. Las existencias ya están apartadas.</Alert>}
      {open && o.paymentMethod === "transfer" && o.paymentStatus === "pending" && (
        <Alert tone="info">El cliente pagará por transferencia. Cuando veas el depósito, usa <strong>Registrar pago</strong>.</Alert>
      )}

      <div className="nx-grid-doc">
        <div className="nx-table-wrap">
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead><tr><th>Producto</th><th className="nx-col-num">Cantidad</th><th className="nx-col-num">Precio</th><th className="nx-col-num">Total</th></tr></thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="nx-cell-product">
                        <Thumb image={i.image} alt="" />
                        <div>
                          <Link to={`/productos/${i.productId}`} style={{ color: "inherit", textDecoration: "none" }}>{i.name}{i.options.length > 0 && <span className="nx-muted"> · {i.options.join(" / ")}</span>}</Link>
                          <div className="nx-sub">{i.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="nx-col-num" style={{ fontWeight: 600 }}>{formatQty(i.quantity, i.unit)}</td>
                    <td className="nx-col-num nx-muted">{money(i.unitPriceCents)}</td>
                    <td className="nx-col-num">{money(i.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "16px 16px 20px", borderTop: "1px solid var(--border)", display: "flex" }}>
            <dl className="nx-doc-totals" style={{ margin: "0 0 0 auto" }}>
              <div><dt>Productos</dt><dd>{money(o.totalCents - o.shippingCents)}</dd></div>
              <div><dt>Envío</dt><dd>{o.shippingCents ? money(o.shippingCents) : "Gratis"}</dd></div>
              <div><dt>IVA incluido</dt><dd>{money(o.taxCents)}</dd></div>
              <div className="nx-doc-totals__grand"><dt>Total</dt><dd>{money(o.totalCents)}</dd></div>
              {o.costCents !== null && <div><dt>Utilidad bruta</dt><dd>{money(o.totalCents - o.shippingCents - o.taxCents - o.costCents)}</dd></div>}
            </dl>
          </div>
        </div>

        <div className="nx-stack" style={{ gap: 24 }}>
          <Card title="Cliente">
            <div className="nx-stack" style={{ gap: 12 }}>
              <div>
                <div style={{ fontWeight: 500 }}>{o.customerName}</div>
                <div className="nx-muted" style={{ fontSize: 13 }}>{o.customerPhone} · {o.customerEmail}</div>
              </div>
              <div className="nx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <a className="nx-btn nx-btn--secondary nx-btn--sm" href={whatsappTo(o.customerPhone, greeting)} target="_blank" rel="noreferrer"><MessageCircle className="nx-icon" aria-hidden="true" />WhatsApp</a>
                <a className="nx-btn nx-btn--ghost nx-btn--sm" href={`tel:${o.customerPhone}`}><Phone className="nx-icon" aria-hidden="true" />Llamar</a>
                <a className="nx-btn nx-btn--ghost nx-btn--sm" href={`mailto:${o.customerEmail}?subject=${encodeURIComponent(`Tu pedido ${orderLabel(o.number)}`)}`}><Mail className="nx-icon" aria-hidden="true" />Correo</a>
              </div>
              {o.notes && <Alert tone="info" title="Notas del cliente">{o.notes}</Alert>}
            </div>
          </Card>
          <Card title={FULFILLMENT_LABELS[o.fulfillment]}>
            <dl className="nx-kv">
              {o.fulfillment === "delivery" ? <div><dt>Dirección</dt><dd style={{ whiteSpace: "pre-wrap", textAlign: "right" }}>{o.address}</dd></div> : <div><dt>Recoge en</dt><dd>{o.locationName}</dd></div>}
              <div><dt>Surte</dt><dd>{o.locationName}</dd></div>
              {o.readyAt && <div><dt>{readyLabel}</dt><dd>{dateTimeFmt.format(new Date(o.readyAt))}</dd></div>}
              {o.completedAt && <div><dt>Entregado</dt><dd>{dateTimeFmt.format(new Date(o.completedAt))}{o.completedByName && ` · ${o.completedByName}`}</dd></div>}
            </dl>
          </Card>
          <Card title="Pago">
            <dl className="nx-kv">
              <div><dt>Eligió</dt><dd>{ONLINE_PAYMENT_LABELS[o.paymentMethod]}</dd></div>
              <div><dt>Estado</dt><dd><PaymentBadge status={o.paymentStatus} /></dd></div>
              {o.paidMethod && <div><dt>Pagó con</dt><dd>{paymentLabel(o.paidMethod)}{o.paidReference && ` · ${o.paidReference}`}</dd></div>}
              {o.paidAt && <div><dt>Fecha</dt><dd>{dateTimeFmt.format(new Date(o.paidAt))}</dd></div>}
            </dl>
          </Card>
          <Card title="Seguimiento del cliente">
            <p className="nx-help" style={{ margin: "0 0 12px" }}>El cliente ve el estado de su pedido en este enlace. Le enviamos un correo en cada cambio.</p>
            <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(o.trackingUrl); toast("Enlace copiado"); }}><Copy className="nx-icon" aria-hidden="true" />Copiar enlace</Button>
          </Card>
        </div>
      </div>
      <PaymentModal mode={paying} order={o} onClose={() => setPaying(null)} onDone={(u) => { setData(u); toast(paying === "complete" ? "Pedido entregado y cobrado" : "Pago registrado"); setPaying(null); }} />
      <CancelOrderModal open={cancelling} order={o} onClose={() => setCancelling(false)} onDone={(u) => { setData(u); setCancelling(false); toast("Pedido cancelado. Avisamos al cliente."); }} />
    </>
  );
}

function PaymentModal({ mode, order, onClose, onDone }: { mode: "pay" | "complete" | null; order: OrderDetail; onClose: () => void; onDone: (o: OrderDetail) => void }) {
  const { money } = useBusiness();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  useEffect(() => {
    if (!mode) return;
    setMethod(order.paymentMethod === "transfer" ? "transfer" : "cash");
    setReference("");
  }, [mode, order.paymentMethod]);
  const save = useSubmit(async () => {
    const payment = { method, reference: reference || null };
    onDone(mode === "complete" ? await post<OrderDetail>(`/orders/${order.id}/complete`, { payment }) : await post<OrderDetail>(`/orders/${order.id}/pay`, payment));
  });
  return (
    <Modal
      open={Boolean(mode)}
      title={mode === "complete" ? "Entregar y cobrar" : "Registrar pago"}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>{mode === "complete" ? `Cobrar ${money(order.totalCents)} y entregar` : `Registrar ${money(order.totalCents)}`}</Button></>}
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <SelectField label="¿Cómo pagó?" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} help={method === "cash" ? `Entra a la caja abierta de ${order.locationName}.` : undefined} error={save.fields.method}>
          {PAYMENT_METHODS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </SelectField>
        {method !== "cash" && <TextField label="Referencia" optional value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Folio de la transferencia o autorización" />}
      </form>
    </Modal>
  );
}

function CancelOrderModal({ open, order, onClose, onDone }: { open: boolean; order: OrderDetail; onClose: () => void; onDone: (o: OrderDetail) => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  const save = useSubmit(async () => onDone(await post<OrderDetail>(`/orders/${order.id}/cancel`, { reason })));
  return (
    <Modal
      open={open}
      title={`¿Cancelar el pedido ${orderLabel(order.number)}?`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button><Button variant="danger" loading={save.pending} onClick={() => void save.submit()}>Cancelar pedido</Button></>}
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        <p style={{ margin: 0 }}>Los productos regresan al inventario y le avisamos al cliente con el motivo.</p>
        {order.paymentStatus === "paid" && <Alert tone="warning">Este pedido ya está pagado ({paymentLabel(order.paidMethod ?? "")}). Tendrás que devolverle el dinero al cliente.</Alert>}
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <TextField label="Motivo (lo verá el cliente)" value={reason} onChange={(e) => setReason(e.target.value)} error={save.fields.reason} placeholder="Nos quedamos sin existencia, no pudimos contactarte…" autoFocus />
      </form>
    </Modal>
  );
}
