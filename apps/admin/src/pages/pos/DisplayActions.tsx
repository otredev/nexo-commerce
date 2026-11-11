/**
 * What the customer can do on the customer display (all optional): register or identify with their
 * phone during the sale, and choose how to get the receipt after paying. Each action is a message with
 * the register's current request id; the register answers through `state.notice`.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Mail, MessageSquareText, Printer, X } from "lucide-react";
import { displaySignupMessageSchema, RECEIPT_METHODS, type DisplaySignupMessage, type DisplayState, type ReceiptMethod } from "@nexo/shared";
import { Button, Checkbox, TextField } from "@nexo/ui";

export type Send = (m: DisplaySignupMessage) => void;

const issues = (e: { issues: Array<{ path: PropertyKey[]; message: string }> }) => {
  const out: Record<string, string> = {};
  for (const i of e.issues) { const k = String(i.path[0] ?? "name"); out[k] ??= i.message; }
  return out;
};

/** Nombre, teléfono, correo y promociones. Used by the full-screen form and by «Registrarme». */
export function SignupFields({ id, send, busy, onSent, onCancel, cancelLabel = "Ahora no" }: { id: string; send: Send; busy: boolean; onSent: () => void; onCancel: () => void; cancelLabel?: string }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", acceptsMarketing: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setForm({ name: "", phone: "", email: "", acceptsMarketing: false }); setErrors({}); }, [id]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = displaySignupMessageSchema.safeParse({ type: "signup", id, ...form });
    if (!r.success) return setErrors(issues(r.error));
    setErrors({});
    send(r.data);
    onSent();
  };
  return (
    <form className="nx-stack" style={{ gap: 14 }} onSubmit={submit} noValidate>
      <TextField label="Nombre" autoComplete="name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} disabled={busy} autoFocus />
      <TextField label="Teléfono" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} maxLength={32} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} disabled={busy} />
      <TextField label="Correo" type="email" inputMode="email" autoComplete="email" optional value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} disabled={busy} />
      <Checkbox label="Quiero recibir promociones y novedades" checked={form.acceptsMarketing} onChange={(e) => setForm({ ...form, acceptsMarketing: e.target.checked })} disabled={busy} />
      <div className="nx-cd__signup-actions">
        <Button type="button" size="lg" variant="ghost" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
        <Button type="submit" size="lg" variant="primary" loading={busy}>Registrarme</Button>
      </div>
    </form>
  );
}

function LoginFields({ id, send, busy, onSent, onCancel }: { id: string; send: Send; busy: boolean; onSent: () => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = displaySignupMessageSchema.safeParse({ type: "login", id, phone });
    if (!r.success) return setError(issues(r.error).phone ?? "Teléfono no válido");
    setError(undefined);
    send(r.data);
    onSent();
  };
  return (
    <form className="nx-stack" style={{ gap: 14 }} onSubmit={submit} noValidate>
      <TextField label="Tu teléfono" type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} error={error} disabled={busy} autoFocus help="El que diste al registrarte. La caja confirmará tu nombre." />
      <div className="nx-cd__signup-actions">
        <Button type="button" size="lg" variant="ghost" disabled={busy} onClick={onCancel}>Volver</Button>
        <Button type="submit" size="lg" variant="primary" loading={busy}>Entrar</Button>
      </div>
    </form>
  );
}

export function Notice({ notice }: { notice: DisplayState["notice"] }) {
  if (!notice) return null;
  return <p className="nx-cd__notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>;
}

/**
 * «Registrarme / Ya soy cliente / Seguir sin registro» under the items, and the form that opens from them.
 * Hidden once the sale has a customer or the customer chose to continue without one.
 */
export function AccountActions({ state, send }: { state: DisplayState; send: Send }) {
  const ask = state.ask;
  const [mode, setMode] = useState<"signup" | "login" | null>(null);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  // An answer from the register ends the wait; success or a customer on the sale closes the form.
  useEffect(() => { if (state.notice && state.notice.tone !== "info") setWaiting(false); }, [state.notice, state.at]);
  useEffect(() => { if (state.customerName) { setMode(null); setWaiting(false); } }, [state.customerName]);
  useEffect(() => { setMode(null); setWaiting(false); }, [ask?.id]);
  if (!ask?.account || state.customerName || hiddenFor === ask.id) return <Notice notice={state.notice} />;
  if (mode) {
    return (
      <div className="nx-cd__panel" role="dialog" aria-label={mode === "signup" ? "Registrarme" : "Ya soy cliente"}>
        <div className="nx-cd__panel-head">
          <h2>{mode === "signup" ? "Regístrate" : "Entra con tu teléfono"}</h2>
          <button type="button" className="nx-cd__close" aria-label="Cerrar" onClick={() => setMode(null)} disabled={waiting}><X size={20} aria-hidden="true" /></button>
        </div>
        {mode === "signup" && <p className="nx-cd__hint" style={{ fontSize: 15 }}>Es opcional. Guardamos tus compras y te avisamos de promociones si quieres.</p>}
        <Notice notice={state.notice} />
        {mode === "signup"
          ? <SignupFields id={ask.id} send={send} busy={waiting} onSent={() => setWaiting(true)} onCancel={() => setMode(null)} cancelLabel="Volver" />
          : <LoginFields id={ask.id} send={send} busy={waiting} onSent={() => setWaiting(true)} onCancel={() => setMode(null)} />}
      </div>
    );
  }
  return (
    <div className="nx-cd__account">
      <Notice notice={state.notice} />
      <div className="nx-cd__account-buttons">
        <Button size="lg" variant="primary" onClick={() => setMode("signup")}>Registrarme</Button>
        <Button size="lg" onClick={() => setMode("login")}>Ya soy cliente</Button>
        <Button size="lg" variant="ghost" onClick={() => setHiddenFor(ask.id)}>Seguir sin registro</Button>
      </div>
    </div>
  );
}

const RECEIPT_ICONS: Record<ReceiptMethod, typeof Mail> = { sms: MessageSquareText, email: Mail, print: Printer, none: X };

/** After paying: «¿Cómo quieres tu recibo?» with the options the owner enabled. */
export function ReceiptChooser({ state, send }: { state: DisplayState; send: Send }) {
  const ask = state.ask;
  const [method, setMethod] = useState<"sms" | "email" | null>(null);
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  useEffect(() => { setMethod(null); setTo(""); setError(undefined); setSent(false); }, [ask?.id]);
  useEffect(() => { if (state.notice?.tone === "error") setSent(false); }, [state.notice, state.at]);
  if (!ask?.receipt?.length) return <Notice notice={state.notice} />;
  const choose = (m: ReceiptMethod, dest: string | null) => {
    const r = displaySignupMessageSchema.safeParse({ type: "receipt", id: ask.id, method: m, to: dest });
    if (!r.success) return setError(issues(r.error).to ?? "Revisa el dato");
    setError(undefined);
    setSent(true);
    send(r.data);
  };
  const onFile = method === "email" ? state.receiptTo?.email : method === "sms" ? state.receiptTo?.phone : null;
  return (
    <div className="nx-cd__receipt">
      <h2 className="nx-cd__receipt-title">¿Cómo quieres tu recibo?</h2>
      <Notice notice={state.notice} />
      {!method ? (
        <div className="nx-cd__receipt-options">
          {ask.receipt.map((m) => {
            const Icon = RECEIPT_ICONS[m];
            return (
              <button key={m} type="button" className="nx-cd__receipt-option" disabled={sent} onClick={() => (m === "sms" || m === "email" ? setMethod(m) : choose(m, null))}>
                <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
                <span>{RECEIPT_METHODS[m]}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <form className="nx-stack" style={{ gap: 12, width: "min(460px, 100%)", textAlign: "left" }} onSubmit={(e) => { e.preventDefault(); choose(method, to.trim() || (onFile ? null : "")); }} noValidate>
          {onFile && <Button size="lg" variant="primary" type="button" loading={sent && !to} disabled={sent} onClick={() => choose(method, null)}>Enviar a {onFile}</Button>}
          <TextField
            label={onFile ? (method === "email" ? "U otro correo" : "U otro teléfono") : method === "email" ? "Tu correo" : "Tu teléfono"}
            type={method === "email" ? "email" : "tel"}
            inputMode={method === "email" ? "email" : "tel"}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            error={error}
            disabled={sent}
            autoFocus={!onFile}
          />
          <div className="nx-cd__signup-actions">
            <Button type="button" size="lg" variant="ghost" disabled={sent} onClick={() => { setMethod(null); setTo(""); setError(undefined); }}>Volver</Button>
            <Button type="submit" size="lg" variant={onFile ? "secondary" : "primary"} loading={sent && Boolean(to)} disabled={sent || (!to.trim() && !onFile)}>Enviar</Button>
          </div>
        </form>
      )}
    </div>
  );
}
