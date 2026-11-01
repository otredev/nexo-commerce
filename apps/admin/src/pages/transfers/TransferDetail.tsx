import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, PackageCheck, Pencil, XCircle } from "lucide-react";
import { docNumber, formatQty, type TransferDetail } from "@nexo/shared";
import { Alert, Button, Card, Modal, PageHeader, TextField, useToast } from "@nexo/ui";
import { get, post, RequestError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { BackLink, dateTimeFmt, parseQty, Steps, TransferStatusBadge } from "../../components/docs";

export function TransferDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: t, error, setData } = useLoad(() => get<TransferDetail>(`/transfers/${id}`), [id]);
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const send = useSubmit(async () => {
    setData(await post<TransferDetail>(`/transfers/${id}/send`));
    toast("Traspaso enviado");
  });
  const cancel = useSubmit(async () => {
    setData(await post<TransferDetail>(`/transfers/${id}/cancel`));
    setCancelling(false);
    toast("Traspaso cancelado");
  });

  if (error) return <Alert tone="danger">{error.status === 404 ? "Este traspaso no existe." : error.message}</Alert>;
  if (!t) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;
  const write = can("transfers:write");
  const showCost = t.items.some((i) => i.unitCostCents !== null);
  const received = t.status === "received";
  const short = received ? t.items.filter((i) => (i.receivedQuantity ?? 0) < i.quantity) : [];
  const lostValue = short.reduce((a, i) => a + Math.round((i.quantity - (i.receivedQuantity ?? 0)) * (i.unitCostCents ?? 0)), 0);
  const notEnough = t.status === "draft" ? t.items.filter((i) => i.originStock < i.quantity) : [];

  return (
    <>
      <BackLink to="/traspasos">Traspasos</BackLink>
      <PageHeader
        title={`Traspaso ${docNumber("transfer", t.number)}`}
        description={<span className="nx-row" style={{ gap: 8 }}><TransferStatusBadge status={t.status} /><span className="nx-row" style={{ gap: 6 }}>{t.fromLocationName}<ArrowRight size={14} aria-label="a" />{t.toLocationName}</span></span>}
        actions={
          <>
            {write && t.status === "draft" && <Button onClick={() => navigate(`/traspasos/${t.id}/editar`)}><Pencil className="nx-icon" aria-hidden="true" />Editar</Button>}
            {write && (t.status === "draft" || t.status === "in_transit") && <Button variant="danger-ghost" onClick={() => setCancelling(true)}><XCircle className="nx-icon" aria-hidden="true" />Cancelar</Button>}
            {write && t.status === "draft" && <Button variant="primary" loading={send.pending} onClick={() => void send.submit()}>Enviar <ArrowRight className="nx-icon" aria-hidden="true" /></Button>}
            {can("transfers:receive") && t.status === "in_transit" && <Button variant="primary" onClick={() => setReceiving(true)}><PackageCheck className="nx-icon" aria-hidden="true" />Confirmar llegada</Button>}
          </>
        }
      />
      {send.message && <Alert tone="danger">{send.message}</Alert>}
      {t.status === "cancelled" ? (
        <Alert tone="danger" title="Traspaso cancelado">{t.cancelledByName} · {t.cancelledAt && dateTimeFmt.format(new Date(t.cancelledAt))}{t.sentAt && ". La mercancía regresó al origen."}</Alert>
      ) : (
        <Steps steps={["Borrador", "En tránsito", "Recibido"]} current={{ draft: 0, in_transit: 1, received: 3 }[t.status]} />
      )}
      {notEnough.length > 0 && <Alert tone="warning">{notEnough.length === 1 ? "Un producto no alcanza" : `${notEnough.length} productos no alcanzan`} en {t.fromLocationName}. Edita las cantidades antes de enviar.</Alert>}
      {t.status === "in_transit" && <Alert tone="info">La mercancía ya salió de {t.fromLocationName}. Quien la reciba en {t.toLocationName} debe confirmar la llegada para que entre a su inventario.</Alert>}
      {short.length > 0 && (
        <Alert tone="warning" title={short.length === 1 ? "Llegó un producto incompleto" : `Llegaron ${short.length} productos incompletos`}>
          La diferencia salió del origen y no entró al destino{showCost && ` (${money(lostValue)} a costo promedio)`}. Revísalo con quien lo transportó.
        </Alert>
      )}

      <div className="nx-grid-doc">
        <div className="nx-table-wrap">
          <div className="nx-table-scroll">
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  {t.status === "draft" && <th className="nx-col-num">Hay en origen</th>}
                  <th className="nx-col-num">Enviado</th>
                  {received && <th className="nx-col-num">Recibido</th>}
                  {showCost && <th className="nx-col-num">Costo prom.</th>}
                </tr>
              </thead>
              <tbody>
                {t.items.map((i) => {
                  const diff = received ? (i.receivedQuantity ?? 0) - i.quantity : 0;
                  return (
                    <tr key={i.id}>
                      <td>{i.name}{i.options.length > 0 && <span className="nx-muted"> · {i.options.join(" / ")}</span>}<div className="nx-mono nx-muted" style={{ fontSize: 12 }}>{i.sku}</div></td>
                      {t.status === "draft" && <td className={`nx-col-num ${i.originStock < i.quantity ? "nx-qty-out" : "nx-muted"}`}>{formatQty(i.originStock, i.unit)}</td>}
                      <td className="nx-col-num">{formatQty(i.quantity, i.unit)}</td>
                      {received && <td className="nx-col-num">{formatQty(i.receivedQuantity ?? 0, i.unit)}{diff < 0 && <div className="nx-diff-down" style={{ fontSize: 12 }}>Faltó {formatQty(+(-diff).toFixed(3), i.unit)}</div>}</td>}
                      {showCost && <td className="nx-col-num nx-muted">{money(i.unitCostCents)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <Card title="Seguimiento">
          <dl className="nx-kv">
            <div><dt>Creado</dt><dd>{dateTimeFmt.format(new Date(t.createdAt))}{t.createdByName && ` · ${t.createdByName}`}</dd></div>
            {t.sentAt && <div><dt>Enviado</dt><dd>{dateTimeFmt.format(new Date(t.sentAt))}{t.sentByName && ` · ${t.sentByName}`}</dd></div>}
            {t.receivedAt && <div><dt>Recibido</dt><dd>{dateTimeFmt.format(new Date(t.receivedAt))}{t.receivedByName && ` · ${t.receivedByName}`}</dd></div>}
            <div><dt>Productos</dt><dd>{t.itemsCount}</dd></div>
            {t.note && <div><dt>Nota</dt><dd style={{ whiteSpace: "pre-wrap" }}>{t.note}</dd></div>}
          </dl>
        </Card>
      </div>
      <ReceiveTransferModal open={receiving} transfer={t} onClose={() => setReceiving(false)} onDone={(u) => { setData(u); setReceiving(false); toast("Llegada confirmada"); }} />
      <Modal
        open={cancelling}
        title={`¿Cancelar ${docNumber("transfer", t.number)}?`}
        onClose={() => setCancelling(false)}
        footer={<><Button variant="ghost" onClick={() => setCancelling(false)}>Volver</Button><Button variant="danger" loading={cancel.pending} onClick={() => void cancel.submit()}>Cancelar traspaso</Button></>}
      >
        <div className="nx-stack">
          {cancel.message && <Alert tone="danger">{cancel.message}</Alert>}
          <p style={{ margin: 0 }}>{t.status === "in_transit" ? `La mercancía regresa al inventario de ${t.fromLocationName}.` : "El borrador queda en el historial como cancelado."}</p>
        </div>
      </Modal>
    </>
  );
}

function ReceiveTransferModal({ open, transfer, onClose, onDone }: { open: boolean; transfer: TransferDetail; onClose: () => void; onDone: (t: TransferDetail) => void }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(transfer.items.map((i) => [i.id, String(i.quantity)])));
    setNote("");
  }, [open, transfer.items]);
  const save = useSubmit(async () => {
    const fields: Record<string, string> = {};
    const items = transfer.items.map((i, n) => {
      const q = parseQty(qty[i.id] ?? "") ?? 0;
      if (!Number.isFinite(q) || q < 0) fields[`items.${n}.receivedQuantity`] = "Cantidad no válida";
      else if (q > i.quantity) fields[`items.${n}.receivedQuantity`] = `Se enviaron ${formatQty(i.quantity, i.unit)}`;
      return { itemId: i.id, receivedQuantity: q };
    });
    if (Object.keys(fields).length) throw new RequestError(422, "validation_error", "Revisa los campos marcados", fields);
    onDone(await post<TransferDetail>(`/transfers/${transfer.id}/receive`, { items, note: note || null }));
  });
  const missing = transfer.items.filter((i) => { const q = parseQty(qty[i.id] ?? ""); return q !== null && Number.isFinite(q) && q < i.quantity; }).length;
  return (
    <Modal
      open={open}
      size="lg"
      title={`Confirmar llegada a ${transfer.toLocationName}`}
      onClose={onClose}
      dismissable={!save.pending}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Confirmar llegada</Button></>}
    >
      <div className="nx-stack">
        <p style={{ margin: 0 }}>Cuenta lo que llegó. Si falta algo, escribe la cantidad real: la diferencia queda registrada.</p>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <div className="nx-table-wrap" style={{ boxShadow: "none" }}>
          <table className="nx-table nx-table--form">
            <thead><tr><th>Producto</th><th className="nx-col-num">Enviado</th><th className="nx-col-num">Llegó</th></tr></thead>
            <tbody>
              {transfer.items.map((i, n) => {
                const err = save.fields[`items.${n}.receivedQuantity`];
                return (
                  <tr key={i.id}>
                    <td>{i.name}{i.options.length > 0 && <span className="nx-muted"> · {i.options.join(" / ")}</span>}</td>
                    <td className="nx-col-num nx-muted">{formatQty(i.quantity, i.unit)}</td>
                    <td className="nx-col-num">
                      <input className="nx-input nx-num nx-line-input" inputMode="decimal" aria-label={`Llegó de ${i.name}`} aria-invalid={Boolean(err)} value={qty[i.id] ?? ""} onChange={(e) => { setQty({ ...qty, [i.id]: e.target.value }); save.clearFields(`items.${n}`); }} />
                      {err && <span className="nx-cell-error">{err}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {missing > 0 && <Alert tone="warning">{missing === 1 ? "Un producto llegó incompleto." : `${missing} productos llegaron incompletos.`} Agrega una nota para explicarlo.</Alert>}
        <TextField label="Nota" optional value={note} onChange={(e) => setNote(e.target.value)} placeholder="Llegó una caja abierta…" />
      </div>
    </Modal>
  );
}
