import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { paymentLabel, parseMoney, type CashSession } from "@nexo/shared";
import { Alert, Button, Card, Modal, Segmented, TextField, useToast } from "@nexo/ui";
import { post, RequestError } from "../../lib/api";
import { useBusiness } from "../../lib/business";
import { useSubmit } from "../../lib/hooks";

const amount = (text: string, field: string) => {
  const v = parseMoney(text);
  if (v === null || v < 0) throw new RequestError(422, "validation_error", "Revisa los campos marcados", { [field]: "Importe no válido" });
  return v;
};

/** Shown instead of the POS while the location's drawer is closed. */
export function OpenCashPanel({ locationId, locationName, onOpened }: { locationId: string; locationName: string; onOpened: (s: CashSession) => void }) {
  const [cash, setCash] = useState("");
  const toast = useToast();
  const open = useSubmit(async () => {
    const s = await post<CashSession>("/cash/open", { locationId, openingCashCents: cash.trim() ? amount(cash, "openingCashCents") : 0 });
    toast("Caja abierta");
    onOpened(s);
  });
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 32, gridColumn: "1 / -1" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Card title={`Abrir caja · ${locationName}`} description="Cuenta el efectivo con el que empiezas el turno (fondo de caja).">
          <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void open.submit(); }}>
            {open.message && <Alert tone="danger">{open.message}</Alert>}
            <TextField label="Efectivo inicial" inputMode="decimal" className="nx-num nx-input--lg" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" error={open.fields.openingCashCents} autoFocus />
            <Button type="submit" variant="primary" size="lg" block loading={open.pending}>Abrir caja</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function CashMovementModal({ session, open, onClose, onDone }: { session: CashSession; open: boolean; onClose: () => void; onDone: (s: CashSession) => void }) {
  const [type, setType] = useState<"in" | "out">("out");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const toast = useToast();
  useEffect(() => { if (open) { setType("out"); setValue(""); setReason(""); } }, [open]);
  const save = useSubmit(async () => {
    const s = await post<CashSession>(`/cash/${session.id}/movements`, { type, amountCents: amount(value, "amountCents"), reason });
    toast(type === "in" ? "Ingreso registrado" : "Retiro registrado");
    onDone(s);
    onClose();
  });
  return (
    <Modal
      open={open}
      title="Efectivo en caja"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>{type === "in" ? "Registrar ingreso" : "Registrar retiro"}</Button></>}
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
        {save.message && <Alert tone="danger">{save.message}</Alert>}
        <Segmented label="Tipo" value={type} onChange={setType} options={[{ id: "out", label: "Retiro" }, { id: "in", label: "Ingreso" }]} />
        <TextField label="Importe" inputMode="decimal" className="nx-num" value={value} onChange={(e) => setValue(e.target.value)} error={save.fields.amountCents} autoFocus />
        <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} error={save.fields.reason} placeholder={type === "out" ? "Pago a proveedor, depósito al banco…" : "Más cambio para la caja…"} />
      </form>
    </Modal>
  );
}

/** Blind close: the cashier enters what they counted; the expected amount appears only afterwards. */
export function CloseCashModal({ session, open, onClose, onClosed }: { session: CashSession; open: boolean; onClose: () => void; onClosed: () => void }) {
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<CashSession | null>(null);
  useEffect(() => { if (open) { setCounted(""); setNote(""); setResult(null); } }, [open]);
  const close = useSubmit(async () => {
    const s = await post<CashSession>(`/cash/${session.id}/close`, { countedCashCents: amount(counted, "countedCashCents"), note: note || null });
    setResult(s);
  });
  const diff = result?.differenceCents ?? 0;
  return (
    <Modal
      open={open}
      title={result ? "Corte de caja" : "Cerrar caja"}
      onClose={result ? onClosed : onClose}
      dismissable={!result}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => navigate(`/caja/${result.id}`)}>Ver corte completo</Button>
            <Button variant="primary" onClick={onClosed}>Listo</Button>
          </>
        ) : (
          <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={close.pending} onClick={() => void close.submit()}>Cerrar caja</Button></>
        )
      }
    >
      {!result ? (
        <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void close.submit(); }}>
          {close.message && <Alert tone="danger">{close.message}</Alert>}
          <p style={{ margin: 0 }}>Cuenta todo el efectivo de la caja, incluido el fondo inicial, y escribe el total.</p>
          <TextField label="Efectivo contado" inputMode="decimal" className="nx-num nx-input--lg" value={counted} onChange={(e) => setCounted(e.target.value)} error={close.fields.countedCashCents} autoFocus />
          <TextField label="Nota" optional value={note} onChange={(e) => setNote(e.target.value)} />
        </form>
      ) : (
        <div className="nx-stack">
          {diff === 0 ? (
            <Alert tone="success" title="La caja cuadra">El efectivo contado coincide con lo esperado.</Alert>
          ) : (
            <Alert tone={diff < 0 ? "danger" : "warning"} title={diff < 0 ? `Faltante de ${money(-diff)}` : `Sobrante de ${money(diff)}`}>Queda registrado en el corte.</Alert>
          )}
          <dl className="nx-kv">
            <div><dt>Ventas</dt><dd>{result.totals?.salesCount ?? 0} · {money(result.totals?.salesTotalCents ?? 0)}</dd></div>
            {Object.entries(result.totals?.byMethod ?? {}).map(([m, v]) => <div key={m}><dt>{paymentLabel(m)}</dt><dd>{money(v)}</dd></div>)}
            <div><dt>Efectivo esperado</dt><dd>{money(result.expectedCashCents)}</dd></div>
            <div><dt>Efectivo contado</dt><dd>{money(result.countedCashCents)}</dd></div>
            <div><dt>Diferencia</dt><dd className={diff < 0 ? "nx-qty-out" : diff > 0 ? "" : "nx-qty-in"}>{money(diff)}</dd></div>
          </dl>
        </div>
      )}
    </Modal>
  );
}
