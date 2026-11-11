import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Banknote, Lock, Minus, Monitor, Percent, Plus, ScanBarcode, ShoppingCart, Tag, Ticket, Trash2, UserPlus, UserRound, X } from "lucide-react";
import { firstNameOf, maskEmail, maskPhone, formatQty, parseMoney, priceCart, unitInfo, type CashSession, type Customer, type DisplaySignupMessage, type DisplayState, type CategoryItem, type Named, type PosProduct, type PromotionRule, type SaleDetail, type TerminalStatus } from "@nexo/shared";
import { categoryTree } from "../../lib/categories";
import { useDisplayPublisher } from "../../lib/customerDisplay";
import { Alert, Badge, Button, EmptyState, Modal, Segmented, TextField, useDebounced, useToast } from "@nexo/ui";
import { get, post, RequestError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { centsToInput, useBusiness } from "../../lib/business";
import { useLoad, useSubmit } from "../../lib/hooks";
import { EMPTY_CART, lineLabel, newClientId, useStored, type Cart, type CartLine } from "../../lib/pos";
import { Thumb } from "../../components/StockBadge";
import { CashMovementModal, CloseCashModal, OpenCashPanel } from "./CashModals";
import { CheckoutModal, type CardOnDisplay } from "./Checkout";
import { CouponModal, CustomerPicker } from "./CustomerCoupon";

const timeFmt = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

/** Request id for the customer display (letters and digits only). */
const mkId = () => newClientId().replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

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

  const categories = useLoad(() => get<CategoryItem[]>("/categories"));
  const params = new URLSearchParams({ locationId: session.locationId, ...(query.trim() && { q: query.trim() }), ...(categoryId && { categoryId }) });
  const results = useLoad(() => get<PosProduct[]>(`/pos/products?${params}`), [params.toString(), refreshKey]);

  // Automatic promotions valid today; refreshed after every sale.
  const promos = useLoad(() => get<PromotionRule[]>("/promotions/live"), [refreshKey]);
  const priced = useMemo(
    () =>
      priceCart(
        cart.lines.map((l) => ({ productId: l.productId, categoryId: l.categoryId ?? null, unitPriceCents: l.priceCents, quantity: l.quantity, taxRateBps: l.taxRateBps, manualDiscountCents: l.discountCents })),
        { promotions: (promos.data ?? []).filter((p) => !p.membersOnly || Boolean(cart.customerId)), coupon: cart.coupon ?? null, manualCartDiscountCents: cart.discountCents, pricesIncludeTax, formatMoney: (c) => money(c) },
      ),
    [cart, pricesIncludeTax, promos.data, money],
  );
  const totals = priced.totals;

  /* ---------- Customer display ---------- */
  const { settings } = useBusiness();
  const display = useDisplayPublisher(tenantId, session.locationId);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [after, setAfter] = useState<{ phase: "paying"; paid: number; change: number } | { phase: "paid"; sale: SaleDetail } | null>(null);
  /** Full-screen «¿Quieres registrarte?» asked by the cashier; `thenPay` = asked when pressing «Cobrar». */
  const [signup, setSignup] = useState<{ id: string; error: string | null; thenPay: boolean; saving: boolean } | null>(null);
  /** The owner decides both in Configuración › Negocio. */
  const signupEnabled = settings?.posCustomerSignup !== false;
  /** Text messages need the business's SMS provider (Integraciones). */
  const smsReady = settings?.smsReady === true;
  const receiptOffer = useMemo(() => (settings?.receiptOptions ?? ["print", "email", "none"]).filter((m) => m !== "sms" || smsReady), [settings?.receiptOptions, smsReady]);
  /** One request id per sale: the display's buttons answer with it, the hub forwards only that one. */
  const [askId, setAskId] = useState(mkId);
  const [notice, setNotice] = useState<DisplayState["notice"]>(null);
  const [receiptDone, setReceiptDone] = useState(false);
  /** Contact of the customer of the sale just paid (the cart is already empty), for the receipt. */
  const [paidContact, setPaidContact] = useState<{ email: string | null; phone: string | null } | null>(null);
  /** Card charge shown on the customer display while it collects it (Tap to Pay). */
  const [cardCharge, setCardCharge] = useState<CardOnDisplay | null>(null);
  const terminal = useLoad(() => get<TerminalStatus>("/pos/terminal"));
  const storeTerminal = terminal.data?.locations.find((l) => l.id === session.locationId);
  const cardOnDisplay = {
    locationId: session.locationId,
    ready: Boolean(terminal.data?.available && storeTerminal?.terminalLocationId && display.cardReady),
    hint: !terminal.data ? null
      : !terminal.data.available ? terminal.data.reason
      : !storeTerminal?.terminalLocationId ? "Activa el cobro con tarjeta de esta tienda en Configuración › Integraciones."
      : !display.code || !display.remote.displays ? "Empareja la app de la pantalla del cliente (botón de monitor)."
      : display.remote.device?.error ?? "La pantalla del cliente no tiene Tap to Pay listo.",
  };
  /** «Ya soy cliente»: who the phone belongs to, for the cashier to confirm. */
  const [confirmLogin, setConfirmLogin] = useState<Customer | null>(null);
  const say = useCallback((tone: "info" | "success" | "error", text: string) => setNotice({ tone, text }), []);
  useEffect(() => { if (!notice || notice.tone === "info") return; const t = setTimeout(() => setNotice(null), 8_000); return () => clearTimeout(t); }, [notice]);
  const newSaleOnDisplay = () => { setAskId(mkId()); setReceiptDone(false); setNotice(null); setPaidContact(null); };
  useEffect(() => {
    if (after?.phase === "paid" && cart.lines.length) { setAfter(null); newSaleOnDisplay(); }
  }, [cart.lines.length, after?.phase]);
  useEffect(() => {
    if (after?.phase !== "paid") return;
    // Time to choose the receipt on the display; a new sale ends it earlier.
    const t = setTimeout(() => { setAfter(null); newSaleOnDisplay(); }, receiptOffer.length && !receiptDone ? 60_000 : 12_000);
    return () => clearTimeout(t);
  }, [after, receiptDone, receiptOffer.length]);
  useEffect(() => {
    if (!settings) return;
    const paid = after?.phase === "paid" ? after.sale : null;
    const state: DisplayState = {
      v: 1,
      business: { name: settings.tradeName, logoKey: settings.logoKey },
      currency: settings.currency,
      locale: settings.locale,
      phase: paid ? "paid" : cardCharge ? "card" : after?.phase === "paying" ? "paying" : signup ? "signup" : cart.lines.length ? "cart" : "idle",
      card: cardCharge && !paid ? cardCharge : null,
      signup: signup && !paid ? { id: signup.id, error: signup.error } : null,
      ask: paid
        ? (receiptOffer.length && !receiptDone ? { id: askId, account: false, receipt: receiptOffer } : null)
        : signupEnabled && !signup && !after && !cart.customerId && cart.lines.length ? { id: askId, account: true, receipt: null } : null,
      receiptTo: paid && paidContact ? { email: maskEmail(paidContact.email), phone: maskPhone(paidContact.phone) } : null,
      notice,
      lines: cart.lines.map((l, i) => ({
        key: l.key,
        name: l.name,
        detail: [l.options.join(" / "), `${money(l.priceCents)} c/u`].filter(Boolean).join(" · "),
        quantity: formatQty(l.quantity, l.unit),
        totalCents: totals.lines[i]?.totalCents ?? 0,
        savingCents: (priced.lines[i]?.promoDiscountCents ?? 0) + l.discountCents,
      })),
      itemsCount: cart.lines.reduce((a, l) => a + (unitInfo(l.unit).decimals ? 1 : l.quantity), 0),
      subtotalCents: paid ? paid.subtotalCents : totals.subtotalCents,
      discountCents: paid ? paid.discountCents : totals.discountCents,
      taxCents: paid ? paid.taxCents : totals.taxCents,
      totalCents: paid ? paid.totalCents : totals.totalCents,
      pricesIncludeTax,
      paidCents: paid ? paid.payments.reduce((a, p) => a + p.amountCents, 0) : after?.phase === "paying" ? after.paid : 0,
      changeCents: paid ? paid.changeCents : after?.phase === "paying" ? after.change : 0,
      customerName: firstNameOf(cart.customerName),
      saleNumber: paid ? paid.number : null,
      at: Date.now(),
    };
    display.publish(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, totals, priced, after, settings, display.publish, pricesIncludeTax, signup, askId, notice, receiptDone, paidContact, signupEnabled, receiptOffer, cardCharge]);

  /* ---------- What the customer does on the display (all optional) ---------- */
  const startSignup = (thenPay: boolean) => setSignup({ id: mkId(), error: null, thenPay, saving: false });
  /** «Cobrar»: offers the sign-up first if the owner wants it, someone is looking and there's no customer yet. */
  const startPay = () => {
    if (signupEnabled && display.active && !cart.customerId) startSignup(true);
    else setPaying(true);
  };
  const endSignup = (pay: boolean) => { setSignup(null); if (pay) setPaying(true); else focusSearch(); };
  const attach = (c: Customer) => setCart((x) => ({ ...x, customerId: c.id, customerName: c.name, customerContact: c.email ?? c.phone ?? "", customerEmail: c.email, customerPhone: c.phone }));
  const live = useRef({ signup, askId, after, paidContact });
  live.current = { signup, askId, after, paidContact };
  /** One display message at a time (a second tap while looking up waits for the next one). */
  const busy = useRef(false);

  const createCustomer = async (m: Extract<DisplaySignupMessage, { type: "signup" }>): Promise<{ customer: Customer; existing: boolean } | { error: string }> => {
    try {
      return { customer: await post<Customer>("/customers?origen=pos", { name: m.name, email: m.email, phone: m.phone, acceptsMarketing: m.acceptsMarketing }), existing: false };
    } catch (e) {
      const err = e as RequestError;
      if (err.code === "duplicate" && err.fields.existingId) {
        // Already a customer (same phone or email): use that record; the cashier sees which one.
        const found = await get<Customer>(`/customers/${err.fields.existingId}`).catch(() => null);
        if (found) return { customer: found, existing: true };
      }
      const field = Object.values(err.fields ?? {}).find((v) => typeof v === "string" && !/^[0-9A-Z]{20,}$/.test(v));
      return { error: err.status === 422 && field ? field : err.status === 403 ? "No pudimos registrarte aquí. Pide ayuda en caja." : "No pudimos registrarte. Intenta de nuevo o pide ayuda en caja." };
    }
  };

  const onDisplayMessage = useCallback(async (m: DisplaySignupMessage) => {
    const now = live.current;
    if (busy.current) return;
    // Full-screen sign-up asked by the cashier.
    if (now.signup && m.id === now.signup.id) {
      const s = now.signup;
      if (s.saving) return;
      if (m.type === "signup_skip") return endSignup(s.thenPay);
      if (m.type !== "signup") return;
      setSignup({ ...s, saving: true, error: null });
      const r = await createCustomer(m);
      if ("error" in r) return setSignup({ ...s, saving: false, error: r.error });
      attach(r.customer);
      toast(r.existing ? `Ya estaba registrado: ${r.customer.name}` : `Cliente registrado: ${r.customer.name}`, "success");
      say("success", `¡Hola, ${firstNameOf(r.customer.name)}!`);
      return endSignup(s.thenPay);
    }
    if (m.id !== now.askId) return;
    busy.current = true;
    try {
      if (m.type === "signup") {
        say("info", "Registrándote…");
        const r = await createCustomer(m);
        if ("error" in r) return say("error", r.error);
        attach(r.customer);
        toast(r.existing ? `Ya estaba registrado: ${r.customer.name}` : `Cliente registrado: ${r.customer.name}`, "success");
        say("success", r.existing ? `¡Hola de nuevo, ${firstNameOf(r.customer.name)}!` : `¡Bienvenido, ${firstNameOf(r.customer.name)}!`);
      } else if (m.type === "login") {
        say("info", "Un momento: la caja está confirmando tu cuenta.");
        const found = await get<Customer>(`/customers/lookup?phone=${encodeURIComponent(m.phone)}`).catch((e: RequestError) => (e.status === 404 ? null : Promise.reject(e))).catch(() => undefined);
        if (found === undefined) return say("error", "No pudimos buscar tu cuenta. Intenta de nuevo o pide ayuda en caja.");
        if (!found) return say("error", "No encontramos una cuenta con ese teléfono. Puedes registrarte.");
        setConfirmLogin(found);
      } else if (m.type === "receipt") {
        const sale = now.after?.phase === "paid" ? now.after.sale : null;
        if (!sale) return;
        if (m.method === "none") { setReceiptDone(true); return say("success", "¡Gracias por tu compra!"); }
        if (m.method === "print") {
          window.open(`/recibo/${sale.id}?imprimir=1`, "recibo", "width=420,height=720");
          setReceiptDone(true);
          return say("success", "Tu recibo se está imprimiendo.");
        }
        const to = m.to ?? (m.method === "email" ? now.paidContact?.email : now.paidContact?.phone) ?? null;
        if (!to) return say("error", m.method === "email" ? "Escribe tu correo." : "Escribe tu teléfono.");
        say("info", "Enviando tu recibo…");
        try {
          if (m.method === "email") await post(`/sales/${sale.id}/email`, { email: to });
          else await post(`/sales/${sale.id}/sms`, { phone: to });
          setReceiptDone(true);
          say("success", m.method === "email" ? "Listo, te enviamos tu recibo por correo." : "Listo, te enviamos tu recibo por mensaje.");
        } catch (e) {
          say("error", (e as RequestError).status === 422 ? (m.method === "email" ? "Ese correo no es válido." : "Ese teléfono no es válido.") : "No pudimos enviar tu recibo. Pide ayuda en caja.");
        }
      }
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCart, toast, say]);
  useEffect(() => { display.onMessage.current = (m) => void onDisplayMessage(m); return () => { display.onMessage.current = null; }; }, [display.onMessage, onDisplayMessage]);
  // Another device answers through the hub's inbox: check it while the display can act.
  const listening = Boolean(signup && !signup.saving) || (signupEnabled && !cart.customerId && cart.lines.length > 0 && !after) || (after?.phase === "paid" && receiptOffer.length > 0 && !receiptDone);
  useEffect(() => {
    if (!listening || !display.code || !display.remote.displays) return;
    const t = setInterval(() => { void display.pollInbox().then(async (list) => { for (const m of list) await onDisplayMessage(m); }); }, 1500);
    return () => clearInterval(t);
  }, [listening, display.code, display.remote.displays, display.pollInbox, onDisplayMessage]);

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
      if (paying || signup || discountFor || customerOpen || cashOpen || closeOpen || couponOpen) return;
      if (e.key === "F2") { e.preventDefault(); if (cart.lines.length && !overLimit && !priced.couponError) startPay(); }
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

  const clear = () => { setCart(EMPTY_CART); setSelected(null); newSaleOnDisplay(); focusSearch(); };
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
          <PosCategories list={categories.data} value={categoryId} onChange={setCategoryId} />
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
          <div className="nx-row" style={{ gap: 2 }}>
            <Button size="sm" variant="ghost" onClick={() => setCustomerOpen(true)}><UserRound className="nx-icon" aria-hidden="true" />{cart.customerName || "Cliente"}</Button>
            {signupEnabled && display.active && !cart.customerId && (
              <Button size="sm" variant="ghost" icon aria-label="Que el cliente se registre en su pantalla" title="Registro en la pantalla del cliente" onClick={() => startSignup(false)}><UserPlus className="nx-icon" aria-hidden="true" /></Button>
            )}
          </div>
          <div className="nx-row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" icon={!display.code} aria-label="Pantalla del cliente" title="Pantalla del cliente" onClick={() => setDisplayOpen(true)}>
              <Monitor className="nx-icon" aria-hidden="true" />
              {display.code && <span className="nx-dot" aria-hidden="true" />}
            </Button>
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
          <Button variant="primary" block disabled={!cart.lines.length || overLimit || Boolean(invalidQty) || Boolean(priced.couponError)} onClick={startPay}>
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
        onClose={() => { setPaying(false); setCardCharge(null); setAfter((a) => (a?.phase === "paying" ? null : a)); focusSearch(); }}
        onProgress={(paid, change) => setAfter({ phase: "paying", paid, change })}
        card={cardOnDisplay}
        onCard={setCardCharge}
        onPaid={(sale: SaleDetail) => { setPaidContact(cart.customerId ? { email: cart.customerEmail ?? null, phone: cart.customerPhone ?? null } : null); setNotice(null); setAfter({ phase: "paid", sale }); setCart(EMPTY_CART); setSelected(null); setRefreshKey((k) => k + 1); }}
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
        onPick={(c) => { setCart({ ...cart, customerId: c?.id ?? null, customerName: c?.name ?? "", customerContact: c ? (c.email ?? c.phone ?? "") : "", customerEmail: c?.email ?? null, customerPhone: c?.phone ?? null }); setCustomerOpen(false); focusSearch(); }}
      />
      <CouponModal open={couponOpen} onClose={() => { setCouponOpen(false); focusSearch(); }} onApply={(coupon) => { setCart({ ...cart, coupon }); setCouponOpen(false); focusSearch(); }} />
      <DisplayModal open={displayOpen} onClose={() => { setDisplayOpen(false); focusSearch(); }} locationId={session.locationId} display={display} signupEnabled={signupEnabled} />
      <Modal
        open={Boolean(confirmLogin)}
        title="¿Es tu cliente?"
        onClose={() => { setConfirmLogin(null); say("error", "No pudimos confirmar tu cuenta. Pide ayuda en caja."); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setConfirmLogin(null); say("error", "No pudimos confirmar tu cuenta. Pide ayuda en caja."); }}>No es</Button>
            <Button variant="primary" onClick={() => { if (confirmLogin) { attach(confirmLogin); say("success", `¡Hola, ${firstNameOf(confirmLogin.name)}!`); toast(`Cliente: ${confirmLogin.name}`, "success"); } setConfirmLogin(null); focusSearch(); }}>Sí, es esta persona</Button>
          </>
        }
      >
        <div className="nx-stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>El cliente entró con su teléfono en la pantalla. Confirma que es esta persona:</p>
          <div className="nx-panel" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 18 }}>{confirmLogin?.name}</div>
            <div className="nx-muted">{[confirmLogin?.phone, confirmLogin?.email].filter(Boolean).join(" · ")}</div>
          </div>
          <p className="nx-help" style={{ margin: 0 }}>Si no estás seguro, pídele su nombre. Con «No es», la pantalla le pide ayuda en caja.</p>
        </div>
      </Modal>
      <Modal
        open={Boolean(signup)}
        title="Registro en la pantalla del cliente"
        onClose={() => endSignup(false)}
        footer={
          <>
            <Button variant="ghost" disabled={signup?.saving} onClick={() => { endSignup(false); setCustomerOpen(true); }}>Lo registro yo</Button>
            {signup?.thenPay ? <Button variant="primary" disabled={signup?.saving} onClick={() => endSignup(true)}>Cobrar sin registro</Button> : <Button disabled={signup?.saving} onClick={() => endSignup(false)}>Cancelar</Button>}
          </>
        }
      >
        <div className="nx-stack" style={{ gap: 12 }}>
          <div className="nx-row" style={{ gap: 10 }}>
            <span className="nx-spinner" aria-hidden="true" />
            <span>{signup?.saving ? "Registrando al cliente…" : "Tu cliente puede escribir su nombre, teléfono o correo en su pantalla, o tocar «Ahora no»."}</span>
          </div>
          {signup?.error && <Alert tone="warning">Le mostramos al cliente: «{signup.error}»</Alert>}
          {!display.active && <Alert tone="warning">No vemos una pantalla del cliente abierta. Ábrela desde el botón de la pantalla, o registra tú al cliente.</Alert>}
          {signup?.thenPay && <p className="nx-help" style={{ margin: 0 }}>Al terminar (o si toca «Ahora no») se abre el cobro.</p>}
        </div>
      </Modal>
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

function DisplayModal({ open, onClose, locationId, display, signupEnabled }: { open: boolean; onClose: () => void; locationId: string; display: ReturnType<typeof useDisplayPublisher>; signupEnabled: boolean }) {
  const pair = useSubmit(async () => { await display.pair(); });
  const unpair = useSubmit(async () => { await display.unpair(); });
  const url = `${window.location.origin}/pantalla`;
  return (
    <Modal open={open} title="Pantalla del cliente" onClose={onClose} footer={<Button onClick={onClose}>Listo</Button>}>
      <div className="nx-stack" style={{ gap: 20 }}>
        <p style={{ margin: 0 }}>Tu cliente ve en otra pantalla lo que vas escaneando, el total y su cambio.</p>
        <section className="nx-stack" style={{ gap: 8 }}>
          <h3 className="nx-label" style={{ margin: 0 }}>Segundo monitor de esta computadora</h3>
          <div>
            <Button onClick={() => window.open(`/pos/cliente?ubicacion=${encodeURIComponent(locationId)}`, "nx-cliente", "popup,width=1024,height=700")}>
              <Monitor className="nx-icon" aria-hidden="true" />Abrir pantalla del cliente
            </Button>
          </div>
          <p className="nx-help" style={{ margin: 0 }}>Arrastra la ventana al monitor del cliente y toca el botón de pantalla completa (abajo a la derecha).</p>
        </section>
        <section className="nx-stack" style={{ gap: 8 }}>
          <h3 className="nx-label" style={{ margin: 0 }}>Otro dispositivo (tablet o TV)</h3>
          {(pair.message || unpair.message) && <Alert tone="danger">{pair.message ?? unpair.message}</Alert>}
          {display.code ? (
            <>
              <p style={{ margin: 0 }}>En el dispositivo abre <a className="nx-link" href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, "")}</a> y escribe:</p>
              <div className="nx-pair-code" aria-label={`Código ${display.code.split("").join(" ")}`}>{display.code}</div>
              <p className="nx-help" style={{ margin: 0 }}>
                {display.remote.error ? display.remote.error : display.remote.displays ? `${display.remote.displays} ${display.remote.displays === 1 ? "pantalla conectada" : "pantallas conectadas"}.` : "Sin pantallas conectadas todavía."}
                {" "}El código vence si nadie lo usa en 24 horas.
              </p>
              <div><Button variant="ghost" loading={unpair.pending} onClick={() => void unpair.submit()}>Terminar emparejamiento</Button></div>
            </>
          ) : (
            <div><Button loading={pair.pending} onClick={() => void pair.submit()}>Conectar otro dispositivo</Button></div>
          )}
        </section>
        <section className="nx-stack" style={{ gap: 8 }}>
          <h3 className="nx-label" style={{ margin: 0 }}>Registro de clientes</h3>
          {signupEnabled ? (
            <p className="nx-help" style={{ margin: 0 }}>Activado. Al tocar «Cobrar» en una venta sin cliente, la pantalla le pregunta «¿Quieres registrarte?» (puede tocar «Ahora no»). También puedes pedírselo con el botón <UserPlus size={13} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> junto a «Cliente».</p>
          ) : (
            <p className="nx-help" style={{ margin: 0 }}>Desactivado. El propietario o un administrador lo activa en Configuración › Negocio.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Main categories; the chosen one (or the parent of the chosen subcategory) opens a row with its subcategories. */
function PosCategories({ list, value, onChange }: { list: CategoryItem[]; value: string; onChange: (id: string) => void }) {
  const tree = categoryTree(list);
  const chosen = list.find((c) => c.id === value);
  const open = tree.find((c) => c.id === (chosen?.parentId ?? chosen?.id));
  return (
    <div className="nx-stack" style={{ gap: 6 }}>
      <div className="nx-row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Button size="sm" variant={value ? "ghost" : "secondary"} onClick={() => onChange("")}>Todo</Button>
        {tree.map((c) => <Button key={c.id} size="sm" variant={open?.id === c.id ? "secondary" : "ghost"} onClick={() => onChange(c.id)}>{c.name}</Button>)}
      </div>
      {open && open.children.length > 0 && (
        <div className="nx-row" style={{ gap: 6, flexWrap: "wrap", paddingLeft: 8 }} role="group" aria-label={`Subcategorías de ${open.name}`}>
          <Button size="sm" variant={value === open.id ? "secondary" : "ghost"} onClick={() => onChange(open.id)}>Todo {open.name}</Button>
          {open.children.map((c) => <Button key={c.id} size="sm" variant={value === c.id ? "secondary" : "ghost"} onClick={() => onChange(c.id)}>{c.name}</Button>)}
        </div>
      )}
    </div>
  );
}
