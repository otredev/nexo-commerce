import { useEffect, useState } from "react";
import { formatQty, MOVEMENT_REASONS, parseMoney, unitInfo, type UnitCode } from "@nexo/shared";
import { Alert, Button, Modal, Segmented, SelectField, TextField, useToast } from "@nexo/ui";
import { post, RequestError } from "../lib/api";
import { useBusiness } from "../lib/business";
import { useSubmit } from "../lib/hooks";

export interface AdjustTarget {
  variantId: string;
  label: string;
  sku: string;
  unit: UnitCode;
  /** Current stock per location, when known. */
  stockByLocation?: Record<string, number>;
  costCents?: number | null;
}

type Kind = "in" | "out" | "set";
const KINDS: Array<{ id: Kind; label: string }> = [
  { id: "in", label: "Entrada" },
  { id: "out", label: "Salida" },
  { id: "set", label: "Conteo" },
];

export function AdjustStockModal({ target, defaultLocationId, onClose, onDone }: { target: AdjustTarget | null; defaultLocationId?: string; onClose: () => void; onDone: () => void }) {
  const { locations, money } = useBusiness();
  const toast = useToast();
  const active = locations.filter((l) => l.active);
  const [kind, setKind] = useState<Kind>("in");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("purchase");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!target) return;
    setKind("in");
    setLocationId(defaultLocationId ?? active.find((l) => l.isDefault)?.id ?? active[0]?.id ?? "");
    setQuantity("");
    setCost("");
    setReason("purchase");
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => setReason(MOVEMENT_REASONS[kind][0].code), [kind]);

  const unit = target ? unitInfo(target.unit) : unitInfo("unit");
  const current = target?.stockByLocation?.[locationId];
  const save = useSubmit(async () => {
    if (!target) return;
    const qty = Number(quantity.replace(",", "."));
    if (!quantity.trim() || !Number.isFinite(qty)) throw new RequestError(422, "validation_error", "Revisa los campos marcados", { quantity: "Escribe una cantidad" });
    let unitCostCents: number | null = null;
    if (kind === "in" && cost.trim()) {
      unitCostCents = parseMoney(cost);
      if (unitCostCents === null) throw new RequestError(422, "validation_error", "Revisa los campos marcados", { unitCostCents: "Importe no válido" });
    }
    await post("/inventory/movements", { variantId: target.variantId, locationId, type: kind, quantity: qty, unitCostCents, reason, note: note || null });
    toast(kind === "set" ? "Conteo registrado" : kind === "in" ? "Entrada registrada" : "Salida registrada");
    onDone();
    onClose();
  });

  return (
    <Modal
      open={target !== null}
      title="Movimiento de inventario"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>
            {kind === "in" ? "Registrar entrada" : kind === "out" ? "Registrar salida" : "Guardar conteo"}
          </Button>
        </>
      }
    >
      {target && (
        <div className="nx-stack">
          <div>
            <div style={{ color: "var(--ink)", fontWeight: 500 }}>{target.label}</div>
            <div className="nx-mono nx-muted">{target.sku}</div>
          </div>
          {save.message && <Alert tone="danger">{save.message}</Alert>}
          <Segmented label="Tipo de movimiento" options={KINDS} value={kind} onChange={setKind} />
          <SelectField label="Ubicación" value={locationId} onChange={(e) => setLocationId(e.target.value)} help={current !== undefined ? `Existencia actual: ${formatQty(current, target.unit)}` : undefined}>
            {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </SelectField>
          <div className="nx-form-grid">
            <TextField
              label={kind === "set" ? `Cantidad contada (${unit.short})` : `Cantidad (${unit.short})`}
              inputMode="decimal"
              className="nx-num"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              error={save.fields.quantity}
              help={kind === "set" ? "La existencia quedará exactamente en esta cantidad." : unit.decimals ? "Hasta 3 decimales." : undefined}
              autoFocus
            />
            {kind === "in" && (
              <TextField
                label="Costo por unidad"
                optional
                inputMode="decimal"
                className="nx-num"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                error={save.fields.unitCostCents}
                help={target.costCents != null ? `Promedio actual: ${money(target.costCents)}` : "Actualiza el costo promedio."}
              />
            )}
          </div>
          <SelectField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} error={save.fields.reason}>
            {MOVEMENT_REASONS[kind].map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </SelectField>
          <TextField label="Nota" optional value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "out" ? "Ej. 3 tazas rotas al desempacar" : "Ej. Factura A-1042"} />
        </div>
      )}
    </Modal>
  );
}
