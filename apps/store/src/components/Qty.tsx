import { Minus, Plus } from "lucide-react";
import { unitInfo, type UnitCode } from "@nexo/shared";
import { stepFor } from "../lib/store";

const round = (n: number) => Math.round(n * 1000) / 1000;

/** − value + control. `max` null = unlimited. */
export function Qty({ value, onChange, unit, max, size = "md", label }: { value: number; onChange: (v: number) => void; unit: UnitCode; max: number | null; size?: "md" | "sm"; label: string }) {
  const step = stepFor(unit);
  const min = step;
  const decimals = unitInfo(unit).decimals;
  return (
    <div className={`st-qty ${size === "sm" ? "st-qty--sm" : ""}`} role="group" aria-label={label}>
      <button type="button" aria-label="Quitar uno" disabled={value <= min} onClick={() => onChange(Math.max(min, round(value - step)))}><Minus size={15} aria-hidden="true" /></button>
      <input
        inputMode={decimals ? "decimal" : "numeric"}
        aria-label="Cantidad"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(",", "."));
          if (!Number.isFinite(n) || n <= 0) return;
          const v = decimals ? round(n) : Math.floor(n);
          onChange(max === null ? v : Math.min(v, max));
        }}
      />
      <button type="button" aria-label="Agregar uno" disabled={max !== null && value + step > max + 1e-9} onClick={() => onChange(round(value + step))}><Plus size={15} aria-hidden="true" /></button>
    </div>
  );
}
