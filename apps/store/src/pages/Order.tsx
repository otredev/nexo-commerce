import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, CreditCard, MessageCircle } from "lucide-react";
import { whatsappLink, customerStatusLabel, FULFILLMENT_LABELS, formatQty, ONLINE_PAYMENT_LABELS, type PublicOrder } from "@nexo/shared";
import { Alert, Button, Modal, useToast } from "@nexo/ui";
import { api, imageUrl, RequestError } from "../lib/api";
import { useStore } from "../lib/store";

const timeFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const label = (n: number) => `#${String(n).padStart(6, "0")}`;

export function OrderPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const back = params.get("pago");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const { slug, link, store, money } = useStore();
  const toast = useToast();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const fresh = params.get("nuevo") === "1";

  useEffect(() => {
    let alive = true;
    const load = () => api<PublicOrder>("GET", `/${slug}/orders/${token}`).then((o) => alive && setOrder(o), (e: RequestError) => alive && setError(e));
    // Back from Stripe: confirm the payment with Stripe right away (the webhook may still be on its way).
    if (back === "ok") {
      api<PublicOrder>("POST", `/${slug}/orders/${token}/payment-status`).then((o) => alive && setOrder(o), () => void load());
    } else void load();
    // Keep it fresh while the customer waits.
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, back === "ok" ? 4_000 : 30_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token]);

  if (error) {
    return (
      <div className="st-wrap st-empty">
        <h1 className="st-empty__title">Pedido no encontrado</h1>
        <p className="st-empty__text">{error.message}</p>
        <Link className="nx-btn nx-btn--secondary" to={link()}>Ir a la tienda</Link>
      </div>
    );
  }
  if (!order || !store) return <div className="nx-page-loading" style={{ minHeight: "50vh" }}><span className="nx-spinner" aria-label="Cargando" /></div>;

  const cancelled = order.status === "cancelled";
  const steps: Array<{ label: string; at: string | null }> = [
    { label: "Recibido", at: order.createdAt },
    { label: "En preparación", at: order.confirmedAt },
    { label: order.fulfillment === "pickup" ? "Listo para recoger" : "En camino", at: order.readyAt },
    { label: "Entregado", at: order.completedAt },
  ];
  const current = { pending: 0, confirmed: 1, ready: 2, completed: 4, cancelled: -1 }[order.status];
  const whatsapp = store.whatsapp ? whatsappLink(store.whatsapp, `Hola, sobre mi pedido ${label(order.number)}`) : null;

  const pay = async () => {
    setPaying(true);
    setPayError(null);
    try {
      const { url } = await api<{ url: string }>("POST", `/${slug}/orders/${token}/pay`);
      window.location.assign(url);
    } catch (e) {
      setPayError((e as RequestError).message);
      setPaying(false);
    }
  };

  const cancel = async () => {
    setPending(true);
    setCancelError(null);
    try {
      setOrder(await api<PublicOrder>("POST", `/${slug}/orders/${token}/cancel`));
      setCancelling(false);
      toast("Pedido cancelado");
    } catch (e) {
      setCancelError((e as RequestError).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="st-wrap">
      <div className="st-track">
        {back && (
          <div style={{ marginBottom: 24 }}>
            {back === "ok" && order.paymentStatus === "paid" && !cancelled ? (
              <Alert tone="success" title={`¡Gracias, ${order.customerName.split(" ")[0]}! Tu pago se recibió.`}>Te enviamos la confirmación por correo. Guarda esta página para seguir tu pedido.</Alert>
            ) : back === "ok" && order.awaitingCardPayment ? (
              <Alert tone="info" title="Estamos confirmando tu pago">Tarda unos segundos. Esta página se actualiza sola.</Alert>
            ) : back === "cancelado" && order.awaitingCardPayment ? (
              <Alert tone="warning" title="No se completó el pago">Tu pedido está apartado por 30 minutos. Puedes intentar de nuevo con el botón de abajo.</Alert>
            ) : null}
          </div>
        )}
        {fresh && !cancelled && (
          <div style={{ marginBottom: 24 }}>
            <Alert tone="success" title={`¡Gracias, ${order.customerName.split(" ")[0]}! Recibimos tu pedido.`}>
              Te enviamos la confirmación por correo. Guarda esta página para seguir tu pedido.
            </Alert>
          </div>
        )}
        <div className="st-track__eyebrow">Pedido {label(order.number)} · {timeFmt.format(new Date(order.createdAt))}</div>
        <h1 className="st-page-title" style={{ margin: "6px 0 0" }}>{customerStatusLabel(order.status, order.fulfillment)}</h1>
        {cancelled ? (
          <div style={{ margin: "24px 0" }}>
            <Alert tone="danger" title="Este pedido se canceló">{order.cancelReason}{order.paymentStatus === "paid" && ". Como ya habías pagado, la tienda te contactará para el reembolso."}</Alert>
          </div>
        ) : (
          <ol className="st-timeline" style={{ listStyle: "none", padding: 0 }}>
            {steps.map((s, i) => (
              <li key={s.label} className="st-timeline__step" data-state={i < current || current === 4 ? "done" : i === current ? "current" : "next"} aria-current={i === current ? "step" : undefined}>
                {s.label}
                {s.at && (i <= current || current === 4) && <span className="st-timeline__time">{timeFmt.format(new Date(s.at))}</span>}
              </li>
            ))}
          </ol>
        )}

        {order.awaitingCardPayment && back !== "ok" && (
          <div className="st-panel" style={{ borderColor: "var(--accent-soft)", background: "color-mix(in srgb, var(--accent-soft) 35%, var(--surface))" }}>
            <h2>Falta el pago</h2>
            <p style={{ margin: "0 0 12px" }}>Paga {money(order.totalCents)} con tarjeta para que la tienda prepare tu pedido. Si no se paga en 30 minutos, se cancela.</p>
            {payError && <div style={{ marginBottom: 12 }}><Alert tone="danger">{payError}</Alert></div>}
            <Button variant="primary" loading={paying} onClick={() => void pay()}><CreditCard className="nx-icon" aria-hidden="true" />Pagar con tarjeta</Button>
          </div>
        )}
        {!cancelled && order.paymentMethod === "transfer" && order.paymentStatus === "pending" && order.transferInstructions && (
          <div className="st-panel" style={{ borderColor: "var(--accent-soft)", background: "color-mix(in srgb, var(--accent-soft) 35%, var(--surface))" }}>
            <h2>Para pagar por transferencia</h2>
            <p className="st-pre" style={{ margin: "0 0 8px" }}>{order.transferInstructions}</p>
            <p className="nx-help" style={{ margin: 0 }}>Monto: <strong>{money(order.totalCents)}</strong>. Usa {label(order.number)} como referencia.</p>
          </div>
        )}
        {order.paymentStatus === "paid" && !cancelled && (
          <div className="st-panel" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <CheckCircle2 size={18} color="var(--success)" aria-hidden="true" /><span>Pago recibido. ¡Gracias!</span>
          </div>
        )}

        <div className="st-panel">
          <h2>{FULFILLMENT_LABELS[order.fulfillment]}</h2>
          {order.fulfillment === "pickup" ? (
            <p className="st-pre" style={{ margin: 0 }}>{[order.pickupAddress, order.pickupInstructions].filter(Boolean).join("\n") || "Te avisaremos por correo cuando esté listo."}</p>
          ) : (
            <p className="st-pre" style={{ margin: 0 }}>{order.address}</p>
          )}
          <p className="nx-help" style={{ margin: "10px 0 0" }}>{ONLINE_PAYMENT_LABELS[order.paymentMethod]}{order.notes && ` · Notas: ${order.notes}`}</p>
        </div>

        <div className="st-panel">
          <h2>Tu pedido</h2>
          <div className="st-summary__lines">
            {order.items.map((i) => (
              <div className="st-summary__line" key={i.id}>
                <div className="st-summary__thumb">{i.image && <img src={imageUrl(i.image)!} alt="" />}</div>
                <div>
                  <div style={{ fontWeight: 500 }}>{i.name}</div>
                  <div style={{ color: "var(--ink-muted)" }}>{[i.options.join(" / "), formatQty(i.quantity, i.unit)].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="nx-num">{money(i.totalCents)}</div>
              </div>
            ))}
          </div>
          <dl className="st-sum" style={{ margin: 0 }}>
            {order.discountCents > 0 && <div style={{ color: "var(--accent-text)" }}><dt style={{ color: "inherit" }}>Descuentos{order.couponCode && ` (cupón ${order.couponCode})`}</dt><dd>−{money(order.discountCents)}</dd></div>}
            <div><dt>Productos</dt><dd>{money(order.totalCents - order.shippingCents)}</dd></div>
            <div><dt>Envío</dt><dd>{order.shippingCents ? money(order.shippingCents) : "Gratis"}</dd></div>
            <div className="st-sum__total"><dt>Total</dt><dd>{money(order.totalCents)}</dd></div>
          </dl>
        </div>

        <div className="nx-row" style={{ marginTop: 24, gap: 12, flexWrap: "wrap" }}>
          <Link className="nx-btn nx-btn--secondary" to={link()}>Seguir comprando</Link>
          {whatsapp && <a className="nx-btn nx-btn--ghost" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="nx-icon" aria-hidden="true" />Escribir a la tienda</a>}
          {order.canCancel && <Button variant="danger-ghost" onClick={() => setCancelling(true)}>Cancelar pedido</Button>}
        </div>
      </div>
      <Modal
        open={cancelling}
        title={`¿Cancelar el pedido ${label(order.number)}?`}
        onClose={() => setCancelling(false)}
        footer={<><Button variant="ghost" onClick={() => setCancelling(false)}>Volver</Button><Button variant="danger" loading={pending} onClick={() => void cancel()}>Sí, cancelar</Button></>}
      >
        {cancelError && <Alert tone="danger">{cancelError}</Alert>}
        <p style={{ margin: 0 }}>Liberaremos los productos que apartaste. Esta acción no se puede deshacer.</p>
      </Modal>
    </div>
  );
}
