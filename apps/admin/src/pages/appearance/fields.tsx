/** Small form pieces shared by the appearance editor: colors, images, dates, code, numbers and list controls. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2, X } from "lucide-react";
import { Button, TextAreaField, TextField } from "@nexo/ui";
import { post } from "../../lib/api";
import { useSubmit } from "../../lib/hooks";

export const newId = () => Math.random().toString(36).slice(2, 10);
export const today = () => new Date().toLocaleDateString("en-CA");

export async function uploadImage(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return (await post<{ key: string }>("/uploads", fd)).key;
}

export function ImagePick({ label, value, onPick, onClear, hint, error }: { label: string; value: string | null; onPick: (key: string) => void; onClear?: () => void; hint: string; error?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const up = useSubmit(async (file: File) => onPick(await uploadImage(file)));
  return (
    <div className="nx-field">
      <span className="nx-label">{label}</span>
      <div className="nx-image-pick">
        {value && <img src={`/files/${value}`} alt="" />}
        <div className="nx-row" style={{ gap: 8 }}>
          <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void up.submit(file); e.target.value = ""; }} />
          <Button size="sm" loading={up.pending} onClick={() => ref.current?.click()}><ImagePlus className="nx-icon" aria-hidden="true" />{value ? "Cambiar" : "Subir"}</Button>
          {value && onClear && <Button size="sm" variant="ghost" onClick={onClear}>Quitar</Button>}
        </div>
      </div>
      <span className="nx-help" style={error || up.fields.file || up.message ? { color: "var(--danger)" } : undefined}>{error ?? up.fields.file ?? up.message ?? hint}</span>
    </div>
  );
}

/** Several images at once (gallery, banners). */
export function MultiUpload({ label, max, onAdd }: { label: string; max: number; onAdd: (keys: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const up = useSubmit(async (files: File[]) => {
    const keys: string[] = [];
    for (const f of files.slice(0, max)) keys.push(await uploadImage(f));
    onAdd(keys);
  });
  return (
    <div className="nx-stack" style={{ gap: 6 }}>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void up.submit(files); e.target.value = ""; }} />
      <div><Button size="sm" loading={up.pending} disabled={max <= 0} onClick={() => ref.current?.click()}><ImagePlus className="nx-icon" aria-hidden="true" />{label}</Button></div>
      {(up.fields.file || up.message) && <span className="nx-help" style={{ color: "var(--danger)" }}>{up.fields.file ?? up.message}</span>}
    </div>
  );
}

export function ColorField({ label, value, fallback, onChange, error, resetLabel = "Volver al del estilo" }: { label: string; value: string | null; fallback: string; onChange: (v: string | null) => void; error?: string; resetLabel?: string }) {
  const [text, setText] = useState(value ?? fallback);
  useEffect(() => { setText(value ?? fallback); }, [value, fallback]);
  const id = useMemo(() => `c-${newId()}`, []);
  return (
    <div className="nx-field">
      <label className="nx-label" htmlFor={id}>{label}</label>
      <div className="nx-color" data-inherited={value ? undefined : ""}>
        <input type="color" aria-label={`${label}: elegir`} value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
        <input
          id={id}
          className="nx-input nx-mono"
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }}
          onBlur={() => setText(value ?? fallback)}
        />
        {value && <button type="button" className="nx-color__reset" aria-label={`${label}: ${resetLabel.toLowerCase()}`} title={resetLabel} onClick={() => onChange(null)}><X className="nx-icon" aria-hidden="true" /></button>}
      </div>
      {error && <span className="nx-help" style={{ color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}

export function DateRange({ value, onChange, error }: { value: { startsOn: string | null; endsOn: string | null }; onChange: (r: { startsOn: string | null; endsOn: string | null }) => void; error?: string }) {
  return (
    <div className="nx-grid-2">
      <TextField label="Desde" optional type="date" value={value.startsOn ?? ""} onChange={(e) => onChange({ ...value, startsOn: e.target.value || null })} />
      <TextField label="Hasta" optional type="date" value={value.endsOn ?? ""} min={value.startsOn ?? undefined} onChange={(e) => onChange({ ...value, endsOn: e.target.value || null })} error={error} help={!error ? "Sin fechas se muestra siempre." : undefined} />
    </div>
  );
}

/** A whole number within limits; empty while typing, the minimum on blur. */
export function NumberField({ label, value, min, max, onChange, help, suffix }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; help?: string; suffix?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <TextField
      label={suffix ? `${label} (${suffix})` : label}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      help={help}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => { const n = Number.parseInt(text, 10); const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; onChange(v); setText(String(v)); }}
    />
  );
}

export function CodeArea({ label, value, max, onChange, error, placeholder, help, rows = 10 }: { label: string; value: string; max: number; onChange: (v: string) => void; error?: string; placeholder?: string; help?: string; rows?: number }) {
  const counter = `${value.length.toLocaleString("es-MX")} / ${max.toLocaleString("es-MX")}`;
  return (
    <TextAreaField
      label={label}
      value={value}
      maxLength={max}
      rows={rows}
      spellCheck={false}
      className="nx-code"
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Tab inserts two spaces instead of leaving the field (Esc then Tab still moves focus).
        if (e.key !== "Tab" || e.shiftKey) return;
        const el = e.currentTarget;
        if (el.dataset.escaped === "1") { el.dataset.escaped = ""; return; }
        e.preventDefault();
        const { selectionStart: s, selectionEnd: t } = el;
        onChange(value.slice(0, s) + "  " + value.slice(t));
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
      }}
      onKeyUp={(e) => { if (e.key === "Escape") e.currentTarget.dataset.escaped = "1"; }}
      error={error}
      help={error ? undefined : [help, counter].filter(Boolean).join(" · ")}
    />
  );
}

/** Up / down / delete buttons of an item in a list. */
export function ItemActions({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (from: number, to: number) => void; onRemove: () => void; label: string }) {
  return (
    <div className="nx-row" style={{ gap: 2 }}>
      <Button size="sm" variant="ghost" icon disabled={index === 0} aria-label={`Subir ${label}`} onClick={() => onMove(index, index - 1)}><ArrowUp className="nx-icon" aria-hidden="true" /></Button>
      <Button size="sm" variant="ghost" icon disabled={index === count - 1} aria-label={`Bajar ${label}`} onClick={() => onMove(index, index + 1)}><ArrowDown className="nx-icon" aria-hidden="true" /></Button>
      <Button size="sm" variant="ghost" icon aria-label={`Quitar ${label}`} onClick={onRemove}><Trash2 className="nx-icon" aria-hidden="true" /></Button>
    </div>
  );
}

export const moveItem = <T,>(list: T[], from: number, to: number) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
};

/** A titled group inside a form. */
export function Group({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="nx-group" role="group" aria-label={title}>
      <div className="nx-group__head"><span className="nx-group__title">{title}</span>{actions}</div>
      <div className="nx-stack" style={{ gap: 14 }}>{children}</div>
    </div>
  );
}
