import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Copy, PackageCheck, Pencil, Send, XCircle } from "lucide-react";
import { bpsToPercent, docNumber, formatQty, parseMoney, toMilli, type PurchaseOrderDetail } from "@nexo/shared";
import { Alert, Button, Card, Modal, PageHeader, Progress, TextAreaField, TextField, useToast } from "@nexo/ui";
import { get, post, RequestError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { centsToInput, useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { BackLink, dateFmt, dateTimeFmt, formatDay, parseQty, PurchaseStatusBadge, Steps } from "../../components/docs";

export function PurchaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: o, error, setData } = useLoad(() => get<PurchaseOrderDetail>(`/purchases/${id}`), [id]);
  const [receiving, setReceiving] = useState(false);
  const [reasonFor, setReasonFor] = useState<"cancel" | "close" | null>(null);
  const [emailing, setEmailing] = useState(false);
  const location = useLocation();
  // Just ordered from the form: offer to email it to the supplier, once.
  useEffect(() => {
    if (!o || !(location.state as { offerEmail?: boolean } | null)?.offerEmail) return;
    navigate(location.pathname, { replace: true, state: null });
    if (o.supplier.email) setEmailing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o?.id]);
  const order = useSubmit(async () => {
    const updated = await post<PurchaseOrderDetail>(`/purchases/${id}/order`);
    setData(updated);
    toast("Orden marcada como pedida");
    if (updated.supplier.email) setEmailing(true);
  });
  const duplicate = useSubmit(async () => {
    const copy = await post<PurchaseOrderDetail>(`/purchases/${id}/duplicate`);
    toast(`Borrador ${docNumber("purchase", copy.number)} creado`);
    navigate(`/compras/${copy.id}/editar`);
  });

  if (error) return <Alert tone="danger">{error.status === 404 ? "Esta orden no existe." : error.message}</Alert>;
  if (!o) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const write = can("purchases:write");
  const open = o.status === "ordered" || o.status === "partial";
  const step = { draft: 0, ordered: 1, partial: 1, received: 2, cancelled: 0 }[o.status];

  return (
    <>
      <BackLink to="/compras">Compras</BackLink>
      <PageHeader
        title={`Orden ${docNumber("purchase", o.number)}`}
        description={<span className="nx-row" style={{ gap: 8 }}><PurchaseStatusBadge status={o.status} /><span>{o.supplier.name} · recibe {o.locationName}</span></span>}
        actions={
          <>
            {write && (o.status === "draft" || o.status === "ordered") && <Button onClick={() => navigate(`/compras/${o.id}/editar`)}><Pencil className="nx-icon" aria-hidden="true" />Editar</Button>}
            {write && o.status !== "cancelled" && <Button onClick={() => setEmailing(true)}><Send className="nx-icon" aria-hidden="true" />Enviar</Button>}
            {write && o.status !== "draft" && <Button onClick={() => void duplicate.submit()} loading={duplicate.pending}><Copy className="nx-icon" aria-hidden="true" />Repetir</Button>}
            {write && (o.status === "draft" || o.status === "ordered") && <Button variant="danger-ghost" onClick={() => setReasonFor("cancel")}><XCircle className="nx-icon" aria-hidden="true" />Cancelar</Button>}
            {write && o.status === "partial" && <Button variant="ghost" onClick={() => setReasonFor("close")}>Cerrar con pendientes</Button>}
            {write && o.status === "draft" && <Button variant="primary" loading={order.pending} onClick={() => void order.submit()}>Marcar como pedida</Button>}
            {can("purchases:receive") && open && <Button variant="primary" onClick={() => setReceiving(true)}><PackageCheck className="nx-icon" aria-hidden="true" />Recibir mercancía</Button>}
          </>
        }
      />
      {(order.message || duplicate.message) && <Alert tone="danger">{order.message ?? duplicate.message}</Alert>}
      {o.status === "cancelled" ? (
        <Alert tone="danger" title="Orden cancelada">{o.cancelReason}{o.cancelledAt && ` · ${dateTimeFmt.format(new Date(o.cancelledAt))}`}</Alert>
      ) : (
        <Steps steps={["Borrador", "Pedida", "Recibida"]} current={o.status === "received" ? 3 : step} />
      )}
      {o.status === "received" && o.cancelReason && <Alert tone="warning" title="Cerrada con pendientes">{o.cancelReason}</Alert>}
      {o.status === "draft" && <Alert tone="info">Es un borrador: revísalo y márcalo como pedida cuando se lo envíes al proveedor.</Alert>}

      <div className="nx-grid-doc">
        <div className="nx-table-wrap">
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead>
                <tr><th>Producto</th><th className="nx-col-num">Pedido</th><th className="nx-col-num">Recibido</th><th className="nx-col-num">Costo</th><th className="nx-col-num">Importe</th></tr>
              </thead>
              <tbody>
                {o.items.map((i) => {
                  const done = i.receivedQuantity >= i.quantity;
                  return (
                    <tr key={i.id}>
                      <td>
                        {i.name}{i.options.length > 0 && <span className="nx-muted"> · {i.options.join(" / ")}</span>}
                        <div className="nx-mono nx-muted" style={{ fontSize: 12 }}>{i.sku}{i.taxRateBps > 0 && <span style={{ fontFamily: "var(--font-sans)" }}> · IVA {bpsToPercent(i.taxRateBps)} %</span>}</div>
                      </td>
                      <td className="nx-col-num">{formatQty(i.quantity, i.unit)}</td>
                      <td className={`nx-col-num ${done ? "nx-qty-in" : ""}`}>
                        {o.status === "draft" ? <span className="nx-muted">—</span> : formatQty(i.receivedQuantity, i.unit)}
                        {o.status === "partial" && !done && <div className="nx-muted" style={{ fontSize: 12 }}>Faltan {formatQty(+(i.quantity - i.receivedQuantity).toFixed(3), i.unit)}</div>}
                      </td>
                      <td className="nx-col-num nx-muted">{money(i.unitCostCents)}</td>
                      <td className="nx-col-num" style={{ fontWeight: 500 }}>{money(i.netCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "16px 16px 20px", borderTop: "1px solid var(--border)", display: "flex" }}>
            <dl className="nx-doc-totals" style={{ margin: "0 0 0 auto" }}>
              <div><dt>Subtotal</dt><dd>{money(o.subtotalCents)}</dd></div>
              <div><dt>Impuestos</dt><dd>{money(o.taxCents)}</dd></div>
              <div className="nx-doc-totals__grand"><dt>Total</dt><dd>{money(o.totalCents)}</dd></div>
            </dl>
          </div>
        </div>

        <div className="nx-stack" style={{ gap: 24 }}>
          {o.status !== "draft" && o.status !== "cancelled" && (
            <Card title="Recepción">
              <div className="nx-stack" style={{ gap: 8 }}>
                <Progress value={o.progress} label="Avance de la recepción" />
                <div className="nx-row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                  <span className="nx-muted">{Math.round(o.progress * 100)} % de las unidades</span>
                  <span>{money(o.receivedCents)} recibido</span>
                </div>
              </div>
            </Card>
          )}
          <Card title="Proveedor">
            <dl className="nx-kv">
              <div><dt>Nombre</dt><dd>{o.supplier.name}</dd></div>
              {o.supplier.contactName && <div><dt>Contacto</dt><dd>{o.supplier.contactName}</dd></div>}
              {o.supplier.email && <div><dt>Correo</dt><dd>{o.supplier.email}</dd></div>}
              {o.supplier.phone && <div><dt>Teléfono</dt><dd>{o.supplier.phone}</dd></div>}
              <div><dt>Crédito</dt><dd>{o.supplier.paymentTermsDays ? `${o.supplier.paymentTermsDays} días` : "Contado"}</dd></div>
            </dl>
          </Card>
          <Card title="Entrega">
            <dl className="nx-kv">
              <div><dt>Recibe</dt><dd>{o.locationName}</dd></div>
              <div><dt>Fecha esperada</dt><dd>{formatDay(o.expectedDate)}</dd></div>
              <div><dt>Creada</dt><dd>{dateFmt.format(new Date(o.createdAt))}{o.createdByName && ` · ${o.createdByName}`}</dd></div>
              {o.orderedAt && <div><dt>Pedida</dt><dd>{dateFmt.format(new Date(o.orderedAt))}</dd></div>}
              {o.note && <div><dt>Notas</dt><dd style={{ whiteSpace: "pre-wrap" }}>{o.note}</dd></div>}
            </dl>
          </Card>
          {o.receipts.length > 0 && (
            <Card title="Recepciones">
              <div className="nx-stack" style={{ gap: 16 }}>
                {o.receipts.map((r) => (
                  <div key={r.id} style={{ fontSize: 13 }}>
                    <div className="nx-row" style={{ justifyContent: "space-between" }}>
                      <strong>{money(r.totalCents)}</strong>
                      <span className="nx-muted">{dateTimeFmt.format(new Date(r.createdAt))}</span>
                    </div>
                    <div className="nx-muted">
                      {r.supplierReference ? `Factura ${r.supplierReference}` : "Sin factura"} · {r.userName}
                      {o.supplier.paymentTermsDays > 0 && ` · vence ${formatDay(r.dueDate)}`}
                    </div>
                    <div className="nx-muted">{r.items.map((x) => `${formatQty(x.quantity, x.unit)} ${x.name}`).join(", ")}</div>
                    {r.note && <div>{r.note}</div>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
      <ReceiveModal open={receiving} order={o} onClose={() => setReceiving(false)} onDone={(u) => { setData(u); setReceiving(false); toast(u.status === "received" ? "Orden recibida completa" : "Recepción registrada"); }} />
      <ReasonModal kind={reasonFor} order={o} onClose={() => setReasonFor(null)} onDone={(u) => { setData(u); setReasonFor(null); toast(reasonFor === "cancel" ? "Orden cancelada" : "Orden cerrada"); }} />
      <EmailModal open={emailing} order={o} onClose={() => setEmailing(false)} />
    </>
  );
}

function ReceiveModal({ open, order, onClose, onDone }: { open: boolean; order: PurchaseOrderDetail; onClose: () => void; onDone: (o: PurchaseOrderDetail) => void }) {
  const { money } = useBusiness();
  const pendingItems = order.items.filter((i) => i.receivedQuantity < i.quantity);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const pendingOf = (i: PurchaseOrderDetail["items"][number]) => +(i.quantity - i.receivedQuantity).toFixed(3);
  const fill = (all: boolean) => setQty(Object.fromEntries(pendingItems.map((i) => [i.id, all ? String(pendingOf(i)) : ""])));
  useEffect(() => {
    if (!open) return;
    fill(true);
    setCost(Object.fromEntries(pendingItems.map((i) => [i.id, centsToInput(i.unitCostCents)])));
    setReference("");
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const rows = pendingItems.map((i, n) => {
    const q = parseQty(qty[i.id] ?? "");
    const c = parseMoney(cost[i.id] ?? "");
    return { item: i, n, q, c, net: q && Number.isFinite(q) && c !== null ? Math.round((c * toMilli(q)) / 1000) : 0 };
  });
  const total = rows.reduce((a, r) => a + r.net, 0);
  const save = useSubmit(async () => {
    const fields: Record<string, string> = {};
    // Every row is sent (0 = nothing arrived) so the server's field paths match the rows.
    const items = rows.map((r) => {
      const q = r.q ?? 0;
      if (!Number.isFinite(q) || q < 0) fields[`items.${r.n}.quantity`] = "Cantidad no válida";
      else if (q > pendingOf(r.item)) fields[`items.${r.n}.quantity`] = `Máximo ${formatQty(pendingOf(r.item), r.item.unit)}`;
      if (q > 0 && (r.c === null || r.c < 0)) fields[`items.${r.n}.unitCostCents`] = "Costo no válido";
      return { orderItemId: r.item.id, quantity: q, unitCostCents: r.c ?? 0 };
    });
    if (Object.keys(fields).length) throw new RequestError(422, "validation_error", "Revisa los campos marcados", fields);
    if (!items.some((i) => i.quantity > 0)) throw new RequestError(422, "validation_error", "Indica la cantidad recibida de al menos un producto.");
    onDone(await post<PurchaseOrderDetail>(`/purchases/${order.id}/receive`, { items, supplierReference: reference || null, note: note || null }));
  });
  // Server field paths index the submitted list; map them back to rows by order item id.
  const fieldFor = (n: number, key: string) => save.fields[`items.${n}.${key}`];

  return (
    <Modal
      open={open}
      size="lg"
      title={`Recibir ${docNumber("purchase", order.number)}`}
      onClose={onClose}
      dismissable={!save.pending}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Recibir {money(total)}</Button></>}
    >
      <div className="nx-stack">
        <p style={{ margin: 0 }}>Cuenta lo que llegó. Las existencias de <strong>{order.locationName}</strong> suben y el costo promedio se recalcula con el costo de la factura.</p>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <div className="nx-row" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => fill(true)}>Todo lo pendiente</Button>
          <Button size="sm" variant="ghost" onClick={() => fill(false)}>Vaciar</Button>
        </div>
        <div className="nx-table-wrap" style={{ boxShadow: "none" }}>
          <table className="nx-table nx-table--form">
            <thead><tr><th>Producto</th><th className="nx-col-num">Pendiente</th><th className="nx-col-num">Llegó</th><th className="nx-col-num">Costo factura</th></tr></thead>
            <tbody>
              {rows.map(({ item, n, c }) => (
                <tr key={item.id}>
                  <td>{item.name}{item.options.length > 0 && <span className="nx-muted"> · {item.options.join(" / ")}</span>}</td>
                  <td className="nx-col-num nx-muted">{formatQty(pendingOf(item), item.unit)}</td>
                  <td className="nx-col-num">
                    <input className="nx-input nx-num nx-line-input" inputMode="decimal" placeholder="0" aria-label={`Recibido de ${item.name}`} aria-invalid={Boolean(fieldFor(n, "quantity"))} value={qty[item.id] ?? ""} onChange={(e) => { setQty({ ...qty, [item.id]: e.target.value }); save.clearFields(`items.${n}`); }} />
                    {fieldFor(n, "quantity") && <span className="nx-cell-error">{fieldFor(n, "quantity")}</span>}
                  </td>
                  <td className="nx-col-num">
                    <input className="nx-input nx-num nx-line-input" inputMode="decimal" aria-label={`Costo de ${item.name}`} aria-invalid={Boolean(fieldFor(n, "unitCostCents"))} value={cost[item.id] ?? ""} onChange={(e) => { setCost({ ...cost, [item.id]: e.target.value }); save.clearFields(`items.${n}`); }} />
                    {c !== null && c !== item.unitCostCents && <span className="nx-help" style={{ display: "block" }}>Pedido a {money(item.unitCostCents)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="nx-form-grid">
          <TextField label="Factura o remisión" optional value={reference} onChange={(e) => setReference(e.target.value)} placeholder="F-1024" />
          <TextField label="Nota" optional value={note} onChange={(e) => setNote(e.target.value)} placeholder="Caja dañada, faltó una pieza…" />
        </div>
      </div>
    </Modal>
  );
}

function ReasonModal({ kind, order, onClose, onDone }: { kind: "cancel" | "close" | null; order: PurchaseOrderDetail; onClose: () => void; onDone: (o: PurchaseOrderDetail) => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (kind) setReason(""); }, [kind]);
  const save = useSubmit(async () => onDone(await post<PurchaseOrderDetail>(`/purchases/${order.id}/${kind}`, { reason })));
  const cancel = kind === "cancel";
  return (
    <Modal
      open={Boolean(kind)}
      title={cancel ? `¿Cancelar ${docNumber("purchase", order.number)}?` : "Cerrar con pendientes"}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Volver</Button><Button variant={cancel ? "danger" : "primary"} loading={save.pending} onClick={() => void save.submit()}>{cancel ? "Cancelar orden" : "Cerrar orden"}</Button></>}
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        <p style={{ margin: 0 }}>{cancel ? "La orden queda en el historial como cancelada. No cambia ninguna existencia." : "Lo que ya llegó se queda en el inventario; lo pendiente ya no se espera."}</p>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} error={save.fields.reason} placeholder={cancel ? "El proveedor no surte, se pidió a otro…" : "Sin existencia con el proveedor…"} autoFocus />
      </form>
    </Modal>
  );
}

function EmailModal({ open, order, onClose }: { open: boolean; order: PurchaseOrderDetail; onClose: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { if (open) { setEmail(order.supplier.email ?? ""); setMessage(""); } }, [open, order.supplier.email]);
  const send = useSubmit(async () => {
    await post(`/purchases/${order.id}/email`, { email, message: message || null });
    toast(`Orden enviada a ${email}`);
    onClose();
  });
  return (
    <Modal
      open={open}
      title={`Enviar ${docNumber("purchase", order.number)} al proveedor`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Ahora no</Button><Button variant="primary" loading={send.pending} onClick={() => void send.submit()}>Enviar</Button></>}
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void send.submit(); }}>
        {send.message && <Alert tone="danger">{send.message}</Alert>}
        <TextField label="Correo del proveedor" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={send.fields.email} autoFocus />
        <TextAreaField label="Mensaje" optional rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Hola${order.supplier.contactName ? ` ${order.supplier.contactName}` : ""}, te compartimos nuestra orden de compra.`} />
        <p className="nx-help" style={{ margin: 0 }}>Se envía la lista de productos con cantidades, costos y totales.</p>
      </form>
    </Modal>
  );
}
