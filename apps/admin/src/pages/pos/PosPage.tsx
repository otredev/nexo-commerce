import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Banknote, Lock, Minus, Percent, Plus, ScanBarcode, ShoppingCart, Tag, Ticket, Trash2, UserRound, X } from "lucide-react";
import { formatQty, parseMoney, priceCart, unitInfo, type CashSession, type Named, type PosProduct, type PromotionRule, type SaleDetail } from "@nexo/shared";
import { Alert, Badge, Button, EmptyState, Modal, Segmented, TextField, useDebounced, useToast } from "@nexo/ui";
import { get, RequestError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { centsToInput, useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { EMPTY_CART, lineLabel, useStored, type Cart, type CartLine } from "../../lib/pos";
import { Thumb } from "../../components/StockBadge";
import { CashMovementModal, CloseCashModal, OpenCashPanel } from "./CashModals";
import { CheckoutModal } from "./Checkout";
import { CouponModal, CustomerPicker } from "./CustomerCoupon";

const timeFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

export function PosPage() {
  const { me, can } = useAuth();
  const { locations, settings, money } = useBusiness();
  const toast = useToast();
  const tenantId = me!.tenant.id;
  const active = locations.filter((l) => l.active);
  const [locationId, setLocationId] = useStored<string>(`nx.pos.location.${tenantId}`, "");
  const location = active.find((l) => l.id === locationId) ?? active.find((l) => l.isDefault) ?? active[0];
  useEffect(() => {
    if (location && location.id !== locationId) setLocationId(location.id);
  }, [location, locationId, setLocationId]);

  useEffect(() => {
    document.body.dataset.pos = "1";
    return () => { delete document.body.dataset.pos; };
  }, []);

  const [session, setSession] = useState<CashSession | null | undefined>(undefined);
  const loadSession = useCallback(async () => {
    if (!location) return;
    setSession(undefined);
    setSession(await get<CashSession | null>(`/cash/current?locationId=${location.id}`).catch(() => null));
  }, [location]);
  useEffect(() => { void loadSession(); }, [loadSession]);

  if (!location) return <div className="nx-page-loading"><span className="nx-spinner" aria-label="Cargando" /></div>;

  return (
    <div className="nx-pos">
      <header className="nx-pos__bar">
        <div className="nx-row" style={{ gap: 12 }}>
          <Link to="/" className="nx-btn nx-btn--ghost nx-btn--sm" aria-label="Volver al panel"><ArrowLeft className="nx-icon" aria-hidden="true" /></Link>
          <span className="nx-brand" style={{ padding: 0 }}><span className="nx-brand-dot" aria-hidden="true" />Nexo</span>
          {active.length > 1 ? (
            <select className="nx-select" style={{ height: "var(--control-sm)", width: "auto" }} aria-label="Ubicación" value={location.id} onChange={(e) => setLocationId(e.target.value)}>
              {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          ) : (
            <span className="nx-muted">{location.name}</span>
          )}
        </div>
        <div className="nx-row" style={{ gap: 12 }}>
          {session ? <Badge tone="success">Caja abierta · {timeFmt.format(new Date(session.openedAt))}</Badge> : session === null ? <Badge tone="warning">Caja cerrada</Badge> : null}
          <span className="nx-muted" style={{ fontSize: 13 }}>{me!.user.name}</span>
        </div>
      </header>
      {session === undefined ? (
        <div className="nx-page-loading" style={{ gridColumn: "1 / -1" }}><span className="nx-spinner" aria-label="Cargando" /></div>
      ) : session === null ? (
        can("cash:operate") ? <OpenCashPanel locationId={location.id} locationName={location.name} onOpened={setSession} /> : <Alert tone="warning">La caja está cerrada.</Alert>
      ) : settings ? (
        <Register key={location.id} tenantId={tenantId} session={session} onSessionChange={setSession} onClosed={() => { toast("Caja cerrada"); void loadSession(); }} money={money} pricesIncludeTax={settings.pricesIncludeTax} maxDiscountBps={can("discount:unlimited") ? null : settings.cashierMaxDiscountBps} />
      ) : null}
    </div>
  );
}

function Register({ tenantId, session, onSessionChange, onClosed, money, pricesIncludeTax, maxDiscountBps }: {
  tenantId: string;
  session: CashSession;
  onSessionChange: (s: CashSession) => void;
  onClosed: () => void;
  money: (c: number | null | undefined) => string;
  pricesIncludeTax: boolean;
  maxDiscountBps: number | null;
}) {
  const toast = useToast();
  const [cart, setCart] = useStored<Cart>(`nx.pos.cart.${tenantId}.${session.locationId}`, EMPTY_CART);
  const [q, setQ] = useState("");
  const query = useDebounced(q, 150);
  const [categoryId, setCategoryId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [discountFor, setDiscountFor] = useState<CartLine | "cart" | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const categories = useLoad(() => get<Named[]>("/categories"));
  const params = new URLSearchParams({ locationId: session.locationId, ...(query.trim() && { q: query.trim() }), ...(categoryId && { categoryId }) });
  const results = useLoad(() => get<PosProduct[]>(`/pos/products?${params}`), [params.toString(), refreshKey]);

  // Automatic promotions valid today; refreshed after every sale.
  const promos = useLoad(() => get<PromotionRule[]>("/promotions/live"), [refreshKey]);
  const priced = useMemo(
    () =>
      priceCart(
        cart.lines.map((l) => ({ productId: l.productId, categoryId: l.categoryId ?? null, unitPriceCents: l.priceCents, quantity: l.quantity, taxRateBps: l.taxRateBps, manualDiscountCents: l.discountCents })),
        { promotions: promos.data ?? [], coupon: cart.coupon ?? null, manualCartDiscountCents: cart.discountCents, pricesIncludeTax, formatMoney: (c) => money(c) },
      ),
    [cart, pricesIncludeTax, promos.data, money],
  );
  const totals = priced.totals;
  // The cashier's limit only counts discounts given by hand.
  const overLimit = maxDiscountBps !== null && priced.manualDiscountCents * 10_000 > totals.subtotalCents * maxDiscountBps;
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);

  const add = useCallback((p: PosProduct, qty?: number) => {
    const step = qty ?? 1;
    setCart((c) => {
      const existing = c.lines.find((l) => l.variantId === p.variantId);
      if (existing) return { ...c, lines: c.lines.map((l) => (l.variantId === p.variantId ? { ...l, quantity: +(l.quantity + step).toFixed(3), stock: p.stock } : l)) };
      const line: CartLine = { key: p.variantId, variantId: p.variantId, productId: p.productId, name: p.name, options: p.options, sku: p.sku, unit: p.unit, priceCents: p.priceCents, taxRateBps: p.taxRateBps, quantity: step, discountCents: 0, stock: p.stock, categoryId: p.categoryId };
      return { ...c, lines: [...c.lines, line] };
    });
    setSelected(p.variantId);
    if (p.stock !== null && p.stock <= 0) toast(`${lineLabel(p)} no tiene existencias en esta ubicación`, "danger");
  }, [setCart, toast]);

  const setQty = (variantId: string, quantity: number) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.max(0, quantity) } : l)) }));
  const remove = (variantId: string) => setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.variantId !== variantId) }));

  /** Scanner or Enter in the search box: add the exact SKU/barcode match, or the only result. */
  const onEnter = async () => {
    const code = q.trim();
    if (!code) return;
    try {
      const found = await get<PosProduct[]>(`/pos/products?locationId=${session.locationId}&q=${encodeURIComponent(code)}&limit=5`);
      const pick = found.find((p) => p.exact) ?? (found.length === 1 ? found[0] : undefined);
      if (pick) {
        add(pick);
        setQ("");
      } else if (!found.length) toast(`No encontramos "${code}"`, "danger");
    } catch (e) {
      toast((e as Error).message, "danger");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paying || discountFor || customerOpen || cashOpen || closeOpen || couponOpen) return;
      if (e.key === "F2") { e.preventDefault(); if (cart.lines.length && !overLimit && !priced.couponError) setPaying(true); }
      else if (e.key === "F4") { e.preventDefault(); if (cart.lines.length) setDiscountFor("cart"); }
      else if (e.key === "Escape") { setQ(""); focusSearch(); }
      else if (selected && document.activeElement === searchRef.current && !q && (e.key === "+" || e.key === "-")) {
        e.preventDefault();
        const line = cart.lines.find((l) => l.variantId === selected);
        if (line) setQty(line.variantId, line.quantity + (e.key === "+" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const clear = () => { setCart(EMPTY_CART); setSelected(null); focusSearch(); };
  const invalidQty = cart.lines.find((l) => l.quantity <= 0 || (!unitInfo(l.unit).decimals && !Number.isInteger(l.quantity)));

  return (
    <>
      <section className="nx-pos__catalog" aria-label="Productos">
        <div className="nx-search-xl">
          <ScanBarcode aria-hidden="true" />
          <input
            ref={searchRef}
            className="nx-input"
            placeholder="Escanea o busca por nombre, SKU o código"
            aria-label="Buscar o escanear producto"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onEnter(); } }}
          />
        </div>
        {categories.data && categories.data.length > 0 && (
          <div className="nx-row" style={{ gap: 6 }}>
            <Button size="sm" variant={categoryId ? "ghost" : "secondary"} onClick={() => setCategoryId("")}>Todo</Button>
            {categories.data.map((c) => <Button key={c.id} size="sm" variant={categoryId === c.id ? "secondary" : "ghost"} onClick={() => setCategoryId(c.id)}>{c.name}</Button>)}
          </div>
        )}
        {results.error && <Alert tone="danger">{results.error.message}</Alert>}
        {results.data && results.data.length === 0 ? (
          <EmptyState icon={<ScanBarcode className="nx-icon" />} title={q ? `Sin resultados para "${q}"` : "No hay productos a la venta"} text={q ? "Revisa el código o busca por nombre." : "Agrega productos activos en el catálogo."} />
        ) : (
          <div className="nx-product-grid" aria-busy={results.loading}>
            {results.data?.map((p) => {
              const low = p.stock !== null && p.stock <= 0;
              return (
                <button key={p.variantId} type="button" className="nx-product" onClick={() => { add(p); focusSearch(); }} aria-label={`Agregar ${lineLabel(p)}, ${money(p.priceCents)}`}>
                  {p.image && <div className="nx-product__media" style={{ aspectRatio: "16 / 10", overflow: "hidden" }}><img src={`/files/${p.image}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" /></div>}
                  <div className="nx-product__body">
                    <span className="nx-product__name">{p.name}</span>
                    {p.options.length > 0 && <span className="nx-muted" style={{ fontSize: 12 }}>{p.options.join(" / ")}</span>}
                    <span className={`nx-product__meta${low ? " nx-product__stock-out" : ""}`}>{p.stock === null ? p.sku : low ? "Sin existencias" : formatQty(p.stock, p.unit)}</span>
                    <span className="nx-product__price">{money(p.priceCents)}{p.unit !== "unit" && p.unit !== "service" ? ` / ${unitInfo(p.unit).short}` : ""}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <aside className="nx-pos__cart" aria-label="Venta actual">
        <div className="nx-row" style={{ justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <Button size="sm" variant="ghost" onClick={() => setCustomerOpen(true)}><UserRound className="nx-icon" aria-hidden="true" />{cart.customerName || "Cliente"}</Button>
          <div className="nx-row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => setCashOpen(true)}><Banknote className="nx-icon" aria-hidden="true" />Efectivo</Button>
            <Button size="sm" variant="ghost" onClick={() => setCloseOpen(true)}><Lock className="nx-icon" aria-hidden="true" />Cerrar caja</Button>
          </div>
        </div>
        <div className="nx-pos__lines">
          {cart.lines.length === 0 ? (
            <EmptyState icon={<ShoppingCart className="nx-icon" />} title="Venta vacía" text="Escanea un código o toca un producto para agregarlo." />
          ) : (
            cart.lines.map((l, i) => {
              const t = totals.lines[i]!;
              const promo = priced.lines[i]!;
              const short = l.stock !== null && l.quantity > l.stock;
              return (
                <div className="nx-pos__line" key={l.key} aria-current={selected === l.variantId} onClick={() => setSelected(l.variantId)}>
                  <div>
                    <div className="nx-pos__line-name">{lineLabel(l)}</div>
                    <div className="nx-pos__line-meta">
                      {money(l.priceCents)} {l.unit !== "unit" && `/ ${unitInfo(l.unit).short}`}
                      {promo.manualDiscountCents > 0 && <> · descuento {money(promo.manualDiscountCents)}</>}
                    </div>
                    {promo.promotionName && (
                      <div className="nx-pos__line-meta" style={{ color: "var(--accent-text)", display: "flex", alignItems: "center", gap: 4 }}>
                        <Tag size={12} aria-hidden="true" />{promo.promotionName} · −{money(promo.promoDiscountCents)}
                      </div>
                    )}
                    {short && <div className="nx-pos__line-meta" style={{ color: "var(--danger)" }}>Solo hay {formatQty(l.stock!, l.unit)}</div>}
                  </div>
                  <div className="nx-pos__line-total">{money(t.grossCents - t.lineDiscountCents)}</div>
                  <div className="nx-pos__line-controls">
                    <div className="nx-stepper">
                      <button type="button" aria-label="Quitar uno" onClick={() => setQty(l.variantId, +(l.quantity - 1).toFixed(3))}><Minus size={14} aria-hidden="true" /></button>
                      <input
                        aria-label={`Cantidad de ${lineLabel(l)}`}
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); if (Number.isFinite(n)) setQty(l.variantId, n); }}
                        onFocus={(e) => e.target.select()}
                      />
                      <button type="button" aria-label="Agregar uno" onClick={() => setQty(l.variantId, +(l.quantity + 1).toFixed(3))}><Plus size={14} aria-hidden="true" /></button>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setDiscountFor(l)}><Percent className="nx-icon" aria-hidden="true" />Descuento</Button>
                    <span style={{ flex: 1 }} />
                    <Button size="sm" variant="ghost" icon aria-label={`Quitar ${lineLabel(l)}`} onClick={() => remove(l.variantId)}><Trash2 className="nx-icon" aria-hidden="true" /></Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="nx-pos__summary">
          <div className="nx-pos__summary-row"><span>Subtotal</span><span>{money(totals.subtotalCents)}</span></div>
          {priced.promoDiscountCents - priced.couponDiscountCents > 0 && (
            <div className="nx-pos__summary-row" style={{ color: "var(--accent-text)" }}><span>Promociones</span><span>−{money(priced.promoDiscountCents - priced.couponDiscountCents)}</span></div>
          )}
          {cart.coupon && (
            <div className="nx-pos__summary-row" style={{ color: priced.couponError ? "var(--warning)" : "var(--accent-text)" }}>
              <span>Cupón {cart.coupon.code}<button type="button" className="nx-link" style={{ border: 0, background: "none", cursor: "pointer", font: "inherit", marginLeft: 6 }} onClick={() => setCart({ ...cart, coupon: null })}>quitar</button></span>
              <span>{priced.couponError ? "No aplica" : `−${money(priced.couponDiscountCents)}`}</span>
            </div>
          )}
          {priced.manualDiscountCents > 0 && (
            <div className="nx-pos__summary-row">
              <span>Descuento{cart.discountCents > 0 && <button type="button" className="nx-link" style={{ border: 0, background: "none", cursor: "pointer", font: "inherit", marginLeft: 6 }} onClick={() => setCart({ ...cart, discountCents: 0 })}>quitar</button>}</span>
              <span>−{money(priced.manualDiscountCents)}</span>
            </div>
          )}
          <div className="nx-pos__summary-row"><span>Impuestos{pricesIncludeTax ? " incluidos" : ""}</span><span>{money(totals.taxCents)}</span></div>
          <div className="nx-pos__summary-total"><span style={{ fontWeight: 500 }}>Total</span><strong>{money(totals.totalCents)}</strong></div>
          {overLimit && <Alert tone="warning">El descuento supera tu límite ({maxDiscountBps! / 100} %). Pide autorización a un administrador.</Alert>}
          {invalidQty && <Alert tone="warning">Revisa la cantidad de {lineLabel(invalidQty)}.</Alert>}
          {priced.couponError && <Alert tone="warning">{priced.couponError}</Alert>}
        </div>
        <div className="nx-pos__pay nx-stack" style={{ gap: 8 }}>
          <Button variant="primary" block disabled={!cart.lines.length || overLimit || Boolean(invalidQty) || Boolean(priced.couponError)} onClick={() => setPaying(true)}>
            Cobrar {money(totals.totalCents)} <kbd>F2</kbd>
          </Button>
          <div className="nx-row" style={{ justifyContent: "space-between" }}>
            <div className="nx-row" style={{ gap: 2 }}>
              <Button size="sm" variant="ghost" disabled={!cart.lines.length} onClick={() => setDiscountFor("cart")}>Descuento <kbd>F4</kbd></Button>
              <Button size="sm" variant="ghost" disabled={!cart.lines.length} onClick={() => setCouponOpen(true)}><Ticket className="nx-icon" aria-hidden="true" />Cupón</Button>
            </div>
            <Button size="sm" variant="danger-ghost" disabled={!cart.lines.length} onClick={clear}><X className="nx-icon" aria-hidden="true" />Cancelar venta</Button>
          </div>
        </div>
      </aside>

      <CheckoutModal
        open={paying}
        totalCents={totals.totalCents}
        build={() => ({
          locationId: session.locationId,
          items: cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, discountCents: l.discountCents })),
          discountCents: cart.discountCents,
          customerName: cart.customerName || null,
          customerContact: cart.customerContact || null,
          customerId: cart.customerId ?? null,
          couponCode: cart.coupon?.code ?? null,
        })}
        onClose={() => { setPaying(false); focusSearch(); }}
        onPaid={(_sale: SaleDetail) => { setCart(EMPTY_CART); setSelected(null); setRefreshKey((k) => k + 1); }}
        onNewSale={() => { setPaying(false); focusSearch(); }}
      />
      <DiscountModal
        target={discountFor}
        baseCents={discountFor === "cart" ? totals.subtotalCents - totals.lines.reduce((a, l) => a + l.lineDiscountCents, 0) - priced.couponDiscountCents : discountFor ? Math.round(discountFor.priceCents * discountFor.quantity) - (priced.lines[cart.lines.findIndex((l) => l.variantId === discountFor.variantId)]?.promoDiscountCents ?? 0) : 0}
        current={discountFor === "cart" ? cart.discountCents : discountFor ? discountFor.discountCents : 0}
        money={money}
        onClose={() => { setDiscountFor(null); focusSearch(); }}
        onApply={(cents) => {
          if (discountFor === "cart") setCart({ ...cart, discountCents: cents });
          else if (discountFor) setCart({ ...cart, lines: cart.lines.map((l) => (l.variantId === discountFor.variantId ? { ...l, discountCents: cents } : l)) });
          setDiscountFor(null);
          focusSearch();
        }}
      />
      <CustomerPicker
        open={customerOpen}
        current={cart.customerId ? { id: cart.customerId, name: cart.customerName } : null}
        onClose={() => { setCustomerOpen(false); focusSearch(); }}
        onPick={(c) => { setCart({ ...cart, customerId: c?.id ?? null, customerName: c?.name ?? "", customerContact: c ? (c.email ?? c.phone ?? "") : "" }); setCustomerOpen(false); focusSearch(); }}
      />
      <CouponModal open={couponOpen} onClose={() => { setCouponOpen(false); focusSearch(); }} onApply={(coupon) => { setCart({ ...cart, coupon }); setCouponOpen(false); focusSearch(); }} />
      <CashMovementModal session={session} open={cashOpen} onClose={() => { setCashOpen(false); focusSearch(); }} onDone={onSessionChange} />
      <CloseCashModal session={session} open={closeOpen} onClose={() => setCloseOpen(false)} onClosed={() => { setCloseOpen(false); onClosed(); }} />
    </>
  );
}

function DiscountModal({ target, baseCents, current, money, onClose, onApply }: { target: CartLine | "cart" | null; baseCents: number; current: number; money: (c: number) => string; onClose: () => void; onApply: (cents: number) => void }) {
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!target) return;
    setMode(current ? "amount" : "percent");
    setValue(current ? centsToInput(current) : "");
  }, [target, current]);
  const apply = useSubmit(async () => {
    if (!value.trim()) return onApply(0);
    let cents: number | null;
    if (mode === "percent") {
      const pct = Number(value.replace(",", ".").replace("%", ""));
      cents = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round((baseCents * pct) / 100) : null;
    } else cents = parseMoney(value);
    if (cents === null || cents < 0 || cents > baseCents) throw new RequestError(422, "validation_error", "Revisa", { value: `Entre 0 y ${money(baseCents)}` });
    onApply(cents);
  });
  return (
    <Modal
      open={target !== null}
      title={target === "cart" ? "Descuento general" : `Descuento · ${target ? lineLabel(target) : ""}`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={() => onApply(0)}>Quitar descuento</Button><Button variant="primary" onClick={() => void apply.submit()}>Aplicar</Button></>}
    >
      <form className="nx-stack" onSubmit={(e) => { e.preventDefault(); void apply.submit(); }}>
        <Segmented label="Tipo de descuento" value={mode} onChange={(m) => { setMode(m); setValue(""); }} options={[{ id: "percent", label: "Porcentaje" }, { id: "amount", label: "Importe" }]} />
        <TextField label={mode === "percent" ? "Porcentaje" : "Importe"} inputMode="decimal" className="nx-num" value={value} onChange={(e) => setValue(e.target.value)} error={apply.fields.value} help={`Sobre ${money(baseCents)}`} autoFocus />
      </form>
    </Modal>
  );
}
