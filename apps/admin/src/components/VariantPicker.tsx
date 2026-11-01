import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { formatQty, type LookupVariant } from "@nexo/shared";
import { get } from "../lib/api";
import { useBusiness } from "../lib/business";
import { Thumb } from "./StockBadge";

/**
 * Search box that finds tracked products at a location (name, SKU or barcode).
 * A barcode scanner types the code and Enter: an exact match is picked right away.
 */
export function VariantPicker({ locationId, onPick, placeholder = "Agregar producto: nombre, SKU o código", showCost = false, exclude, autoFocus, label = "Agregar producto" }: {
  locationId: string;
  onPick: (v: LookupVariant) => void;
  placeholder?: string;
  showCost?: boolean;
  /** Variants already in the document: shown as added. */
  exclude?: Set<string>;
  autoFocus?: boolean;
  label?: string;
}) {
  const { money } = useBusiness();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LookupVariant[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const listId = useId();

  const search = async (text: string) => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ locationId, limit: "12", ...(text.trim() && { q: text.trim() }) });
      const found = await get<LookupVariant[]>(`/inventory/lookup?${params}`);
      if (n === seq.current) { setItems(found); setActive(0); }
      return found;
    } finally {
      if (n === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !locationId) return;
    const id = setTimeout(() => void search(q).catch(() => {}), 180);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, locationId]);

  const pick = (v: LookupVariant) => {
    onPick(v);
    setQ("");
    setItems([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Escape") { setOpen(false); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!q.trim()) return;
      // Scanner: search now (do not wait for the debounce) and take an exact match.
      const found = await search(q).catch(() => [] as LookupVariant[]);
      const exact = found.find((v) => v.exact);
      if (exact) pick(exact);
      else if (open && found[active]) pick(found[active]!);
      else setOpen(true);
    }
  };

  return (
    <div className="nx-picker" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <div className="nx-input-group">
        <svg className="nx-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          ref={inputRef}
          className="nx-input"
          style={{ height: "var(--control-md)" }}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          value={q}
          autoFocus={autoFocus}
          disabled={!locationId}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => void onKeyDown(e)}
        />
      </div>
      {open && (
        <ul className="nx-picker__list" id={listId} role="listbox" aria-label="Productos">
          {items.length === 0 ? (
            <li className="nx-picker__empty">{loading ? "Buscando…" : q ? "Ningún producto con inventario coincide." : "Escribe para buscar."}</li>
          ) : (
            items.map((v, i) => (
              <li
                key={v.variantId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="nx-picker__option"
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(v)}
              >
                <Thumb image={v.image} alt="" />
                <div className="nx-picker__main">
                  <div className="nx-picker__name">{v.name}{v.options.length > 0 && <span className="nx-muted"> · {v.options.join(" / ")}</span>}</div>
                  <div className="nx-picker__meta">{v.sku}</div>
                </div>
                <div className="nx-picker__side">
                  {exclude?.has(v.variantId) ? <span>Ya agregado</span> : <span>Hay {formatQty(v.stock, v.unit)}</span>}
                  {showCost && v.costCents !== null && <div>{money(v.costCents)}</div>}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
