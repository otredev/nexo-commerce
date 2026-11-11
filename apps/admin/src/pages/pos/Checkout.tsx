import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Check, CreditCard, Landmark, Nfc, Printer, Wallet } from "lucide-react";
import { formatFolio, parseMoney, PAYMENT_METHODS, paymentLabel, settle, type PaymentMethod, type SaleDetail, type SaleInput, type TerminalPayment } from "@nexo/shared";
import { Alert, Button, Modal, TextField, useToast } from "@nexo/ui";
import { get, post, RequestError } from "../../lib/api";
import { centsToInput, useBusiness } from "../../lib/business";
import { useSubmit } from "../../lib/hooks";
import { newClientId, quickCash } from "../../lib/pos";

const ICONS: Record<PaymentMethod, typeof Wallet> = { cash: Banknote, card: CreditCard, transfer: Landmark, other: Wallet };

interface Payment { method: PaymentMethod; amountCents: number; reference: string | null; paymentIntentId?: string | null }
export type CardOnDisplay = TerminalPayment & { attempt: number };

/**
 * Payment step. The clientId is created once per checkout and reused on every retry,
 * so a timeout followed by "Cobrar" again never charges twice.
 */
export function CheckoutModal({ open, totalCents, build, onClose, onPaid, onNewSale, onProgress, card, onCard }: {
  open: boolean;
  totalCents: number;
  build: () => Omit<SaleInput, "clientId" | "payments">;
  onClose: () => void;
  onPaid: (sale: SaleDetail) => void;
  onNewSale: () => void;
  /** What has been received so far and the change, for the customer display. */
  onProgress?: (paidCents: number, changeCents: number) => void;
  /** Tap to Pay on the customer display: whether it can charge now, and why not. */
  card?: { ready: boolean; hint: string | null; locationId: string };
  /** The card charge to show on the customer display (null = none). */
  onCard?: (c: CardOnDisplay | null) => void;
}) {
  const { money } = useBusiness();
  const toast = useToast();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [value, setValue] = useState("");
  const [reference, setReference] = useState("");
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [email, setEmail] = useState("");
  const clientId = useRef(newClientId());
  const inputRef = useRef<HTMLInputElement>(null);
  const [cardPay, setCardPayState] = useState<CardOnDisplay | null>(null);
  const setCardPay = (c: CardOnDisplay | null) => { setCardPayState(c); onCard?.(c); };

  const totalRef = useRef(totalCents);
  totalRef.current = totalCents;
  // Reset only when the dialog opens: after a successful sale the cart (and its total) is cleared
  // while the success screen is still showing.
  useEffect(() => {
    if (!open) return;
    const totalCents = totalRef.current;
    clientId.current = newClientId();
    setPayments([]);
    setMethod("cash");
    setValue(centsToInput(totalCents));
    setReference("");
    setSale(null);
    setEmail("");
    setCardPayState(null);
    setTimeout(() => inputRef.current?.select(), 30);
  }, [open]);

  const paid = payments.reduce((a, p) => a + p.amountCents, 0);
  const remaining = Math.max(0, totalCents - paid);
  const typed = parseMoney(value) ?? 0;
  const draft: Payment[] = useMemo(() => (typed > 0 ? [...payments, { method, amountCents: typed, reference: reference || null }] : payments), [payments, method, typed, reference]);
  const check = settle(totalCents, draft);
  const change = check.ok ? check.changeCents : 0;
  const draftPaid = draft.reduce((a, p) => a + p.amountCents, 0);
  useEffect(() => {
    if (open && !sale) onProgress?.(draftPaid, change);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sale, draftPaid, change]);

  const pick = (m: PaymentMethod) => {
    setMethod(m);
    setValue(centsToInput(remaining));
    setTimeout(() => inputRef.current?.select(), 0);
  };
  const addPartial = () => {
    if (typed <= 0 || typed >= remaining) return;
    setPayments([...payments, { method, amountCents: typed, reference: reference || null }]);
    setValue(centsToInput(remaining - typed));
    setReference("");
    setMethod(method === "cash" ? "card" : "cash");
  };

  const charge = useSubmit(async (list?: Payment[]) => {
    const pays = list ?? draft;
    const ok = settle(totalCents, pays);
    if (!ok.ok) throw new RequestError(422, "payment_error", ok.message);
    const created = await post<SaleDetail>("/sales", { ...build(), clientId: clientId.current, payments: pays });
    setSale(created);
    setCardPay(null);
    onPaid(created);
  });

  /* ---------- Card on the customer display (Stripe Terminal, Tap to Pay) ---------- */
  const cardAmount = method === "card" && typed > 0 ? Math.min(typed, remaining) : remaining;
  const startCard = useSubmit(async () => {
    if (!card) return;
    const p = await post<TerminalPayment>("/pos/terminal/payments", { locationId: card.locationId, amountCents: cardAmount, clientId: clientId.current });
    setCardPay({ ...p, attempt: 1 });
  });
  const cancelCard = async () => {
    const c = cardPay;
    setCardPay(null);
    if (c && c.status !== "succeeded") await post(`/pos/terminal/payments/${c.id}/cancel`).catch(() => {});
  };
  const refunds = useSubmit(async () => {
    for (const p of payments.filter((x) => x.paymentIntentId)) await post(`/pos/terminal/payments/${p.paymentIntentId}/refund`);
    setPayments(payments.filter((x) => !x.paymentIntentId));
    toast("Cobro con tarjeta reembolsado");
  });
  // The server asks Stripe how the charge is going (the device is never trusted).
  useEffect(() => {
    if (!cardPay || cardPay.status === "succeeded" || cardPay.status === "canceled") return;
    let stop = false;
    const t = setInterval(async () => {
      const p = await get<TerminalPayment>(`/pos/terminal/payments/${cardPay.id}`).catch(() => null);
      if (!p || stop) return;
      if (p.status === cardPay.status && p.error === cardPay.error) return;
      // After «Reintentar», a past decline still shows until the device collects again.
      if (p.status === "failed" && cardPay.status === "waiting" && cardPay.attempt > 1 && p.error === cardPay.error) return;
      const next = { ...p, attempt: cardPay.attempt };
      setCardPay(next);
      if (p.status === "succeeded") {
        const list = [...payments, { method: "card" as const, amountCents: p.amountCents, reference: "Tarjeta · Stripe", paymentIntentId: p.id }];
        setPayments(list);
        const left = totalCents - list.reduce((a, x) => a + x.amountCents, 0);
        if (left <= 0) void charge.submit(list);
        else { setMethod("cash"); setValue(centsToInput(left)); setTimeout(() => setCardPay(null), 2500); }
      }
    }, 1500);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPay?.id, cardPay?.status, cardPay?.attempt, cardPay?.error]);
  const cardBusy = Boolean(cardPay && cardPay.status !== "failed" && cardPay.status !== "canceled");
  const paidByCard = payments.some((p) => p.paymentIntentId);
  const sendEmail = useSubmit(async () => {
    if (!sale) return;
    await post(`/sales/${sale.id}/email`, { email });
    toast(`Recibo enviado a ${email}`);
    setEmail("");
  });
  const printReceipt = () => sale && window.open(`/recibo/${sale.id}?imprimir=1`, "recibo", "width=420,height=720");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || (e.target as HTMLElement).closest("[data-no-enter]")) return;
      e.preventDefault();
      if (sale) onNewSale();
      else if (check.ok && !charge.pending && !cardPay) void charge.submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sale, check.ok, charge, onNewSale]);

  if (sale) {
    return (
      <Modal open={open} title={`Venta ${formatFolio(sale.number)}`} onClose={onNewSale} footer={<Button variant="primary" size="lg" onClick={onNewSale}>Nueva venta <kbd>Enter</kbd></Button>}>
        <div className="nx-stack" style={{ alignItems: "center", textAlign: "center", gap: 12 }}>
          <div className="nx-success-mark"><Check size={28} strokeWidth={2} aria-hidden="true" /></div>
          <div style={{ color: "var(--ink)", fontWeight: 500 }}>Venta registrada por {money(sale.totalCents)}</div>
          {sale.changeCents > 0 && (
            <div>
              <div className="nx-muted">Cambio</div>
              <div className="nx-big-number">{money(sale.changeCents)}</div>
            </div>
          )}
          <div className="nx-row" style={{ justifyContent: "center" }}>
            <Button onClick={printReceipt}><Printer className="nx-icon" aria-hidden="true" />Imprimir recibo</Button>
          </div>
          <form className="nx-row" style={{ width: "100%", alignItems: "flex-end" }} data-no-enter onSubmit={(e) => { e.preventDefault(); void sendEmail.submit(); }}>
            <div style={{ flex: 1, textAlign: "left" }}>
              <TextField label="Enviar recibo por correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={sale.customerContact?.includes("@") ? sale.customerContact : "cliente@correo.com"} error={sendEmail.fields.email ?? sendEmail.message ?? undefined} />
            </div>
            <Button type="submit" loading={sendEmail.pending} disabled={!email}>Enviar</Button>
          </form>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="Cobrar"
      onClose={() => { void cancelCard(); onClose(); }}
      dismissable={!charge.pending && !cardBusy && !paidByCard}
      footer={
        <>
          <Button variant="ghost" onClick={() => { void cancelCard(); onClose(); }} disabled={charge.pending || cardBusy || paidByCard}>Volver</Button>
          <Button variant="primary" size="lg" disabled={!check.ok || Boolean(cardPay)} loading={charge.pending} onClick={() => void charge.submit()}>
            {charge.pending ? "Cobrando" : `Cobrar ${money(totalCents)}`} {!charge.pending && <kbd>Enter</kbd>}
          </Button>
        </>
      }
    >
      <div className="nx-stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="nx-muted">Total</span>
          <span className="nx-big-number">{money(totalCents)}</span>
        </div>
        {charge.message && <Alert tone="danger">{charge.message}</Alert>}
        {charge.message && paidByCard && (
          <Alert tone="warning">
            La tarjeta ya se cobró pero la venta no se guardó. Corrige lo que dice arriba y vuelve a cobrar (no se cobra dos veces), o reembolsa la tarjeta.{" "}
            <Button size="sm" variant="ghost" loading={refunds.pending} onClick={() => void refunds.submit()}>Reembolsar tarjeta</Button>
            {refunds.message && <div style={{ color: "var(--danger)" }}>{refunds.message}</div>}
          </Alert>
        )}
        {cardPay && (
          <div className="nx-card-wait" data-status={cardPay.status}>
            <div className="nx-row" style={{ gap: 10, alignItems: "center" }}>
              {cardPay.status === "succeeded" ? <Check size={20} aria-hidden="true" /> : cardPay.status === "failed" ? <CreditCard size={20} aria-hidden="true" /> : <span className="nx-spinner" aria-hidden="true" />}
              <strong>{money(cardPay.amountCents)}</strong>
              <span>
                {cardPay.status === "waiting" && "Esperando la tarjeta en la pantalla del cliente…"}
                {cardPay.status === "processing" && "Procesando el pago…"}
                {cardPay.status === "succeeded" && "Pago aprobado"}
                {cardPay.status === "failed" && (cardPay.error ?? "No se pudo cobrar")}
                {cardPay.status === "canceled" && "Cobro cancelado"}
              </span>
            </div>
            {cardPay.status !== "succeeded" && (
              <div className="nx-row" style={{ gap: 8, marginTop: 10 }}>
                {cardPay.status === "failed" && <Button size="sm" variant="primary" onClick={() => setCardPay({ ...cardPay, status: "waiting", attempt: cardPay.attempt + 1 })}>Reintentar</Button>}
                <Button size="sm" variant="ghost" onClick={() => void cancelCard()}>Cancelar cobro con tarjeta</Button>
              </div>
            )}
          </div>
        )}
        {payments.length > 0 && (
          <div>
            {payments.map((p, i) => (
              <div className="nx-pay-row" key={i}>
                <span>{paymentLabel(p.method)}{p.reference && <span className="nx-muted"> · {p.reference}</span>}</span>
                <span>{money(p.amountCents)}</span>
                <Button size="sm" variant="ghost" onClick={() => setPayments(payments.filter((_, j) => j !== i))}>Quitar</Button>
              </div>
            ))}
            <div className="nx-pay-row" style={{ borderBottom: 0 }}><span className="nx-muted">Falta</span><strong>{money(remaining)}</strong><span /></div>
          </div>
        )}
        <div className="nx-method-grid" role="group" aria-label="Método de pago">
          {PAYMENT_METHODS.map((m) => {
            const Icon = ICONS[m.code];
            return (
              <button key={m.code} type="button" className="nx-method" aria-pressed={method === m.code} onClick={() => pick(m.code)}>
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" />{m.label}
              </button>
            );
          })}
        </div>
        <div className="nx-form-grid">
          <TextField
            label={method === "cash" ? "Recibido" : "Importe"}
            inputMode="decimal"
            className="nx-num nx-input--lg"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputRef={inputRef}
            help={method === "cash" ? undefined : "Tarjeta y transferencia no generan cambio."}
          />
          {method !== "cash" && <TextField label="Referencia" optional value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Autorización, folio…" />}
          {method === "card" && card && !cardPay && (
            <div className="nx-span-2 nx-stack" style={{ gap: 6 }}>
              <Button variant="primary" disabled={!card.ready || cardAmount <= 0} loading={startCard.pending} onClick={() => void startCard.submit()}>
                <Nfc className="nx-icon" aria-hidden="true" />Cobrar {money(cardAmount)} en la pantalla del cliente
              </Button>
              <span className="nx-help">{startCard.message ?? (card.ready ? "El cliente acerca su tarjeta o teléfono a la pantalla (Tap to Pay)." : card.hint ?? "Conecta la app de la pantalla del cliente con Tap to Pay.")}</span>
            </div>
          )}
          {method === "cash" && (
            <div className="nx-field">
              <span className="nx-label">Cambio</span>
              <div className="nx-big-number" style={{ fontSize: 28, lineHeight: "44px", color: change ? "var(--ink)" : "var(--ink-subtle)" }}>{money(change)}</div>
            </div>
          )}
        </div>
        {method === "cash" && (
          <div className="nx-quick-amounts">
            {quickCash(remaining || totalCents).map((v) => (
              <Button key={v} size="sm" onClick={() => setValue(centsToInput(v))}>{v === remaining ? "Exacto" : money(v)}</Button>
            ))}
          </div>
        )}
        {typed > 0 && typed < remaining && (
          <div>
            <Button size="sm" variant="ghost" onClick={addPartial}>Pagar {money(typed)} con {paymentLabel(method).toLowerCase()} y dividir el resto</Button>
          </div>
        )}
        {!check.ok && typed > 0 && typed >= remaining && <span className="nx-help" style={{ color: "var(--danger)" }}>{check.message}</span>}
      </div>
    </Modal>
  );
}
