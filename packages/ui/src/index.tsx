/**
 * Thin React components over the design system classes (styles/components.css).
 * Components only apply classes: every visual decision lives in tokens + CSS.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/* ---------- Button ---------- */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: boolean;
  block?: boolean;
  loading?: boolean;
}
export function Button({ variant = "secondary", size = "md", icon, block, loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("nx-btn", `nx-btn--${variant}`, size !== "md" && `nx-btn--${size}`, icon && "nx-btn--icon", block && "nx-btn--block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="nx-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ---------- Field ---------- */
interface FieldShellProps {
  label: string;
  help?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}
function FieldShell({ label, help, error, optional, className, children }: FieldShellProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const hasHelp = Boolean(error || help);
  return (
    <div className={cx("nx-field", error && "nx-field--error", className)}>
      <label className="nx-label" htmlFor={id}>
        {label} {optional && <span className="nx-optional">(opcional)</span>}
      </label>
      {children(id, hasHelp ? helpId : undefined)}
      {hasHelp && (
        <span className="nx-help" id={helpId}>
          {error ?? help}
        </span>
      )}
    </div>
  );
}

type Common = { label: string; help?: ReactNode; error?: string; optional?: boolean; fieldClassName?: string };

export function TextField({ label, help, error, optional, fieldClassName, className, inputRef, ...rest }: Common & InputHTMLAttributes<HTMLInputElement> & { inputRef?: Ref<HTMLInputElement> }) {
  return (
    <FieldShell label={label} help={help} error={error} optional={optional} className={fieldClassName}>
      {(id, describedBy) => (
        <input ref={inputRef} id={id} className={cx("nx-input", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      )}
    </FieldShell>
  );
}

export function SelectField({ label, help, error, optional, fieldClassName, className, children, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} help={help} error={error} optional={optional} className={fieldClassName}>
      {(id, describedBy) => (
        <select id={id} className={cx("nx-select", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function TextAreaField({ label, help, error, optional, fieldClassName, className, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} help={help} error={error} optional={optional} className={fieldClassName}>
      {(id, describedBy) => (
        <textarea id={id} className={cx("nx-textarea", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      )}
    </FieldShell>
  );
}

export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="nx-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Checkbox({ label, help, ...rest }: { label: ReactNode; help?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="nx-choice">
      <input type="checkbox" {...rest} />
      <span>
        {label}
        {help && <span className="nx-help">{help}</span>}
      </span>
    </label>
  );
}

/* ---------- Badge ---------- */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";
export function Badge({ tone = "neutral", plain, children }: { tone?: Tone; plain?: boolean; children: ReactNode }) {
  return <span className={cx("nx-badge", tone !== "neutral" && `nx-badge--${tone}`, plain && "nx-badge--plain")}>{children}</span>;
}

/* ---------- Card ---------- */
export function Card({ title, description, actions, footer, children, flat, bodyClassName }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; footer?: ReactNode; children?: ReactNode; flat?: boolean; bodyClassName?: string }) {
  return (
    <section className={cx("nx-card", flat && "nx-card--flat")}>
      {(title || actions) && (
        <header className="nx-card__header">
          <div>
            {title && <h2 className="nx-card__title">{title}</h2>}
            {description && <p className="nx-card__desc">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children && <div className={cx("nx-card__body", bodyClassName)}>{children}</div>}
      {footer && <footer className="nx-card__footer">{footer}</footer>}
    </section>
  );
}

/* ---------- Stat ---------- */
export function Stat({ label, value, meta }: { label: string; value: ReactNode; meta?: ReactNode }) {
  return (
    <div className="nx-stat">
      <div className="nx-stat__label">{label}</div>
      <div className="nx-stat__value">{value}</div>
      {meta && <div className="nx-stat__meta">{meta}</div>}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="nx-page-header">
      <div>
        <h1 className="nx-page-title">{title}</h1>
        {description && <p className="nx-page-desc">{description}</p>}
      </div>
      {actions && <div className="nx-row">{actions}</div>}
    </div>
  );
}

/* ---------- Tabs ---------- */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="nx-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="nx-tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Alert ---------- */
const alertIcon = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle } as const;
export function Alert({ tone = "info", title, children }: { tone?: keyof typeof alertIcon; title?: ReactNode; children?: ReactNode }) {
  const Icon = alertIcon[tone];
  return (
    <div className={cx("nx-alert", `nx-alert--${tone}`)} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="nx-icon" aria-hidden="true" />
      <div>
        {title && <div className="nx-alert__title">{title}</div>}
        {children && <div className="nx-alert__text">{children}</div>}
      </div>
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon, title, text, actions }: { icon: ReactNode; title: string; text?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="nx-empty">
      <div className="nx-empty__icon">{icon}</div>
      <h3 className="nx-empty__title">{title}</h3>
      {text && <p className="nx-empty__text">{text}</p>}
      {actions && (
        <div className="nx-row" style={{ justifyContent: "center", marginTop: 8 }}>
          {actions}
        </div>
      )}
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({ open, title, onClose, children, footer, size = "md", dismissable = true }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "md" | "lg"; dismissable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([aria-label='Cerrar'])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose();
      if (e.key === "Tab" && ref.current) {
        const items = ref.current.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
        const list = Array.from(items).filter((el) => !el.hasAttribute("disabled"));
        if (!list.length) return;
        const head = list[0]!;
        const tail = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
        else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [open, onClose, dismissable]);
  if (!open) return null;
  return (
    <div className="nx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose(); }}>
      <div ref={ref} className={cx("nx-modal", size === "lg" && "nx-modal--lg")} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="nx-modal__header">
          <h2 className="nx-modal__title" id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" icon aria-label="Cerrar" onClick={onClose}>
            <X className="nx-icon" aria-hidden="true" />
          </Button>
        </div>
        <div className="nx-modal__body">{children}</div>
        {footer && <div className="nx-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */
type ToastItem = { id: number; message: string; tone: "success" | "danger" };
const ToastContext = createContext<(message: string, tone?: ToastItem["tone"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems([{ id, message, tone }]); // one at a time
    setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="nx-toast-region" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="nx-toast">
            {t.tone === "success" ? <CheckCircle2 className="nx-icon" aria-hidden="true" /> : <XCircle className="nx-icon" aria-hidden="true" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/* ---------- Avatar ---------- */
export function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return <span className="nx-avatar" aria-hidden="true">{initials || "?"}</span>;
}

/* ---------- Search input ---------- */
export function SearchInput({ value, onChange, placeholder, label, width = 280, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; width?: number; autoFocus?: boolean }) {
  return (
    <div className="nx-input-group" style={{ width, maxWidth: "100%" }}>
      <svg className="nx-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input className="nx-input" style={{ height: "var(--control-sm)", fontSize: 13 }} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus={autoFocus} type="search" />
    </div>
  );
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="nx-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Pagination footer ---------- */
export function Pagination({ page, pageSize, total, onPage, noun = "registros" }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun?: string }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="nx-table-footer">
      <span className="nx-num">{from}–{to} de {total} {noun}</span>
      <div className="nx-pagination">
        <Button variant="secondary" size="sm" icon aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <svg className="nx-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </Button>
        <Button variant="secondary" size="sm" icon aria-label="Página siguiente" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <svg className="nx-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </Button>
      </div>
    </div>
  );
}

/* ---------- Progress ---------- */
export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="nx-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="nx-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------- Debounce hook ---------- */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
