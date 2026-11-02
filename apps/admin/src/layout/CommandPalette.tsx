/**
 * Ctrl+K / ⌘K search: pages and shortcuts by keyword (synonyms included, accents ignored),
 * plus live results from the business's data (products, customers, orders, suppliers).
 * Keyboard: ↑ ↓ to move, Enter to open, Esc to close.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Clock, Contact, CornerDownLeft, Package, Search, ShoppingBag, Warehouse } from "lucide-react";
import { formatQty, normalizeSearch, type Customer, type OrderListItem, type Paginated, type ProductListItem, type Supplier } from "@nexo/shared";
import { useDebounced } from "@nexo/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useBusiness } from "../lib/business";
import { ACTIONS, NAV, type Icon, type NavItem } from "./nav";

interface Result {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: Icon;
  to: string;
}

const RECENT_KEY = "nx-cmdk-recent";
const readRecent = (): Result[] => {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Array<Omit<Result, "icon">>).map((r) => ({ ...r, icon: Clock })); } catch { return []; }
};
const saveRecent = (r: Result) => {
  try {
    const keep = readRecent().filter((x) => x.to !== r.to).slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ ...r, group: "Recientes", icon: undefined }, ...keep].map(({ icon: _, ...x }) => x)));
  } catch { /* private mode */ }
};

/** Every word must appear; a match in the label ranks above one in the keywords. */
function score(item: NavItem, words: string[]) {
  const label = normalizeSearch(item.label);
  const all = `${label} ${normalizeSearch(item.keywords ?? "")}`;
  if (!words.every((w) => all.includes(w))) return 0;
  if (label.startsWith(words[0]!)) return 3;
  if (words.every((w) => label.includes(w))) return 2;
  return 1;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, me } = useAuth();
  const { money } = useBusiness();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [live, setLive] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = useDebounced(q.trim(), 200);

  // Mounted only while open (fresh state every time); the input takes focus on mount.

  // Pages and shortcuts the user can open.
  const allowed = (i: NavItem) => (!i.permission || can(i.permission)) && (!i.platform || Boolean(me?.platformAdmin));
  const local = useMemo<Result[]>(() => {
    const words = normalizeSearch(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const pages = NAV.flatMap((s) => s.items.map((i) => ({ ...i, group: s.group ?? "General" })))
      .filter(allowed)
      .map((i) => ({ i, s: score(i, words) }));
    const actions = ACTIONS.filter(allowed).map((i) => ({ i: { ...i, group: "Acciones" }, s: score(i, words) }));
    return [...pages, ...actions]
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map(({ i }) => ({ id: `nav:${i.to}:${i.label}`, group: i.group === "Acciones" ? "Acciones" : "Ir a", label: i.label, hint: i.group === "Acciones" ? undefined : i.group, icon: i.icon, to: i.to }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, me]);

  // Data of the business, once there are 2+ characters.
  useEffect(() => {
    if (!open || query.length < 2) { setLive([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const enc = encodeURIComponent(query);
    const safe = <T,>(p: Promise<T>) => p.catch(() => null);
    void Promise.all([
      can("catalog:read") ? safe(get<Paginated<ProductListItem>>(`/products?q=${enc}&pageSize=5`)) : null,
      can("customers:read") ? safe(get<Paginated<Customer>>(`/customers?q=${enc}&pageSize=4`)) : null,
      can("orders:read") ? safe(get<{ items: OrderListItem[] }>(`/orders?status=all&q=${enc}&pageSize=4`)) : null,
      can("suppliers:read") ? safe(get<Supplier[]>(`/suppliers?q=${enc}`)) : null,
    ]).then(([products, customers, orders, suppliers]) => {
      if (!alive) return;
      const out: Result[] = [];
      products?.items.forEach((p) => out.push({
        id: `p:${p.id}`, group: "Productos", icon: Package, to: `/productos/${p.id}`, label: p.name,
        hint: [p.sku, money(p.priceMin), p.trackInventory ? `${formatQty(p.stock, p.unit)} en existencia` : null].filter(Boolean).join(" · "),
      }));
      customers?.items.forEach((c) => out.push({ id: `c:${c.id}`, group: "Clientes", icon: Contact, to: `/clientes/${c.id}`, label: c.name, hint: [c.phone, c.email].filter(Boolean).join(" · ") || undefined }));
      orders?.items.forEach((o) => out.push({ id: `o:${o.id}`, group: "Pedidos", icon: ShoppingBag, to: `/pedidos/${o.id}`, label: `Pedido #${String(o.number).padStart(6, "0")} · ${o.customerName}`, hint: money(o.totalCents) }));
      suppliers?.slice(0, 4).forEach((s) => out.push({ id: `s:${s.id}`, group: "Proveedores", icon: Warehouse, to: `/proveedores?q=${encodeURIComponent(s.name)}`, label: s.name, hint: [s.phone, s.email].filter(Boolean).join(" · ") || undefined }));
      setLive(out);
      setLoading(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  const results = q.trim() ? [...local, ...live] : readRecent().filter((r) => r.to);
  useEffect(() => setActive(0), [q, live.length]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (r: Result) => {
    saveRecent(r);
    onClose();
    navigate(r.to);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]!); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  if (!open) return null;
  let lastGroup = "";
  const searching = q.trim().length >= 2 && (loading || query !== q.trim());

  return createPortal(
    <div className="nx-cmdk-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nx-cmdk" role="dialog" aria-modal="true" aria-label="Buscar">
        <div className="nx-cmdk__input">
          <Search className="nx-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Busca páginas, productos, clientes, pedidos…"
            role="combobox"
            aria-expanded="true"
            aria-controls="nx-cmdk-list"
            aria-activedescendant={results[active] ? `nx-cmdk-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <span className="nx-spinner" aria-label="Buscando" style={{ width: 14, height: 14 }} />}
          <kbd className="nx-kbd">Esc</kbd>
        </div>
        <div className="nx-cmdk__list" id="nx-cmdk-list" role="listbox" ref={listRef}>
          {results.length === 0 && (
            <p className="nx-cmdk__empty">
              {!q.trim() ? "Escribe para buscar. Prueba con «iva», «corte», «nuevo producto» o el nombre de un cliente." : searching ? "Buscando…" : `Nada coincide con «${q.trim()}».`}
            </p>
          )}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            const Icon = r.icon;
            return (
              <div key={r.id + i}>
                {header && <div className="nx-cmdk__group">{header}</div>}
                <div
                  id={`nx-cmdk-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className="nx-cmdk__item"
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(r)}
                >
                  <Icon className="nx-icon" aria-hidden="true" />
                  <span className="nx-cmdk__label">{r.label}</span>
                  {r.hint && <span className="nx-cmdk__hint">{r.hint}</span>}
                  {i === active && <CornerDownLeft className="nx-icon nx-cmdk__enter" aria-hidden="true" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="nx-cmdk__footer">
          <span><kbd className="nx-kbd">↑</kbd><kbd className="nx-kbd">↓</kbd> moverte</span>
          <span><kbd className="nx-kbd">Enter</kbd> abrir</span>
          <span><kbd className="nx-kbd">Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "⌘K" on Mac, "Ctrl K" elsewhere. */
export const shortcutLabel = () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K");
