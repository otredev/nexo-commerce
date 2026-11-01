import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Check, CreditCard, Landmark, Printer, Wallet } from "lucide-react";
import { formatFolio, parseMoney, PAYMENT_METHODS, paymentLabel, settle, type PaymentMethod, type SaleDetail, type SaleInput } from "@nexo/shared";
import { Alert, Button, Modal, TextField, useToast } from "@nexo/ui";
import { post, RequestError } from "../../lib/api";
import { centsToInput, useBusiness } from "../../lib/business";
import { useSubmit } from "../../lib/hooks";
import { newClientId, quickCash } from "../../lib/pos";

const ICONS: Record<PaymentMethod, typeof Wallet> = { cash: Banknote, card: CreditCard, transfer: Landmark, other: Wallet };

interface Payment { method: PaymentMethod; amountCents: number; reference: string | null }

/**
 * Payment step. The clientId is created once per checkout and reused on every retry,
 * so a timeout followed by "Cobrar" again never charges twice.
 */
export function CheckoutModal({ open, totalCents, build, onClose, onPaid, onNewSale }: {
  open: boolean;
  totalCents: number;
  build: () => Omit<SaleInput, "clientId" | "payments">;
  onClose: () => void;
  onPaid: (sale: SaleDetail) => void;
  onNewSale: () => void;
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
    setTimeout(() => inputRef.current?.select(), 30);
  }, [open]);

  const paid = payments.reduce((a, p) => a + p.amountCents, 0);
  const remaining = Math.max(0, totalCents - paid);
  const typed = parseMoney(value) ?? 0;
  const draft: Payment[] = useMemo(() => (typed > 0 ? [...payments, { method, amountCents: typed, reference: reference || null }] : payments), [payments, method, typed, reference]);
  const check = settle(totalCents, draft);
  const change = check.ok ? check.changeCents : 0;

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

  const charge = useSubmit(async () => {
    if (!check.ok) throw new RequestError(422, "payment_error", check.message);
    const created = await post<SaleDetail>("/sales", { ...build(), clientId: clientId.current, payments: draft });
    setSale(created);
    onPaid(created);
  });
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
      else if (check.ok && !charge.pending) void charge.submit();
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
      onClose={onClose}
      dismissable={!charge.pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={charge.pending}>Volver</Button>
          <Button variant="primary" size="lg" disabled={!check.ok} loading={charge.pending} onClick={() => void charge.submit()}>
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
