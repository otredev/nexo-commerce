import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { MAX_KEYWORDS, normalizeKeyword } from "@nexo/shared";

/**
 * Keywords as removable chips. Enter, comma or Tab adds what's typed; pasting "a, b, c" adds all three;
 * Backspace on an empty field removes the last one. Suggests the business's existing keywords.
 */
export function KeywordsInput({
  label, value, onChange, suggestions = [], error, help, disabled,
}: { label: string; value: string[]; onChange: (v: string[]) => void; suggestions?: string[]; error?: string; help?: string; disabled?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_KEYWORDS;
  const add = (raw: string) => {
    const next = [...value];
    for (const part of raw.split(/[,;\n]/)) {
      const k = normalizeKeyword(part).slice(0, 40);
      if (k && !next.includes(k) && next.length < MAX_KEYWORDS) next.push(k);
    }
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "," || (e.key === "Tab" && draft.trim())) && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Enter") {
      e.preventDefault();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const describedBy = `${id}-help`;
  const options = suggestions.filter((s) => !value.includes(s));

  return (
    <div className={`nx-field${error ? " nx-field--error" : ""}`}>
      <label className="nx-label" htmlFor={id}>{label} <span className="nx-optional">(opcional)</span></label>
      <div className="nx-tags" aria-invalid={error ? true : undefined} onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
        {value.map((k) => (
          <span key={k} className="nx-tags__tag">
            {k}
            {!disabled && (
              <button type="button" aria-label={`Quitar ${k}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== k)); }}>
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            id={id}
            className="nx-tags__input"
            value={draft}
            list={options.length ? `${id}-list` : undefined}
            placeholder={full ? `Máximo ${MAX_KEYWORDS}` : value.length ? "Agregar otra…" : "Ej. sin gluten, vegano"}
            disabled={full}
            aria-describedby={describedBy}
            onChange={(e) => {
              const v = e.target.value;
              // Picking a suggestion (not typing one letter by letter) or pasting a list adds right away.
              const picked = (e.nativeEvent as InputEvent).inputType !== "insertText" && options.includes(v);
              if (/[,;\n]/.test(v) || picked) add(v);
              else setDraft(v);
            }}
            onKeyDown={onKey}
            onBlur={() => draft.trim() && add(draft)}
          />
        )}
        {options.length > 0 && <datalist id={`${id}-list`}>{options.map((s) => <option key={s} value={s} />)}</datalist>}
      </div>
      <span id={`${id}-help`} className="nx-help">{error ?? help ?? "Separa con coma o Enter. Sirven para buscar y filtrar en el panel y en la tienda."}</span>
    </div>
  );
}
