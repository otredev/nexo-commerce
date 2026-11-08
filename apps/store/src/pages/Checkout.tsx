import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FULFILLMENT_LABELS, POLICY_INFO, type Fulfillment, type OnlinePaymentMethod, type StoreProduct } from "@nexo/shared";
import { Alert, Button, TextAreaField, TextField } from "@nexo/ui";
import { api, imageUrl, RequestError, track } from "../lib/api";
import { useStore, type CartLine } from "../lib/store";
import { useAccount } from "../lib/account";
import { AuthForm } from "../components/AuthForm";

const newClientId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const SAVED = "nx-customer";

export function CheckoutPage() {
  const { slug, link, store, cart, money, totals, replace, clear, coupon, setCoupon, linePrice, reload } = useStore();
  const { account, ready: accountReady, refresh: refreshAccount, logout } = useAccount();
  const [code, setCode] = useState(coupon?.code ?? "");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const navigate = useNavigate();
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVED) ?? "{}") as Record<string, string>; } catch { return {}; } })();
  const [name, setName] = useState(saved.name ?? "");
  const [email, setEmail] = useState(saved.email ?? "");
  const [phone, setPhone] = useState(saved.phone ?? "");
  const [address, setAddress] = useState(saved.address ?? "");
  const [notes, setNotes] = useState("");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [payment, setPayment] = useState<OnlinePaymentMethod>("on_delivery");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState(false);
  const [accepted, setAccepted] = useState(false);
  // One id per checkout: retrying after a network error never creates two orders.
  const clientId = useRef(newClientId());

  useEffect(() => { track(slug, "checkout_start"); }, [slug]);
  // Signed in: the account's details fill the form (the email is always the account's).
  useEffect(() => {
    if (!account) return;
    setName((v) => v || account.name);
    setEmail(account.email);
    setPhone((v) => v || account.phone || "");
    setAddress((v) => v || account.address || "");
  }, [account]);
  useEffect(() => {
    if (!store) return;
    if (!store.pickupEnabled) setFulfillment("delivery");
    if (!store.payOnDelivery) setPayment(store.transferEnabled ? "transfer" : "card");
  }, [store]);

  /** Refreshes prices and stock of the cart from the store before paying. */
  const refresh = async (): Promise<CartLine[]> => {
    const ids = [...new Set(cart.map((l) => l.productId))];
    const products = await Promise.all(ids.map((id) => api<StoreProduct>("GET", `/${slug}/products/${id}`).catch(() => null)));
    const changes: string[] = [];
    const next: CartLine[] = [];
    for (const line of cart) {
      const p = products[ids.indexOf(line.productId)];
      const v = p?.variants.find((x) => x.id === line.variantId);
      if (!p || !v) { changes.push(`${line.name} ya no está disponible`); continue; }
      let quantity = line.quantity;
      if (v.available !== null && quantity > v.available) {
        if (v.available <= 0) { changes.push(`${line.name} se agotó`); continue; }
        quantity = v.available;
        changes.push(`De ${line.name} solo quedan ${v.available}`);
      }
      if (v.displayPriceCents !== line.displayPriceCents) changes.push(`${line.name} cambió de precio`);
      next.push({ ...line, priceCents: v.priceCents, displayPriceCents: v.displayPriceCents, taxRateBps: p.taxRateBps, available: v.available, quantity, categoryId: p.categoryId });
    }
    replace(next);
    await reload().catch(() => {});
    setNotice(changes.length ? `Actualizamos tu carrito: ${changes.join("; ")}.` : null);
    return next;
  };
  useEffect(() => {
    if (!cart.length) { setChecked(true); return; }
    refresh().finally(() => setChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!store) return null;
  if (checked && cart.length === 0) {
    return (
      <div className="st-wrap st-empty">
        <h1 className="st-empty__title">Tu carrito está vacío</h1>
        {notice && <p className="st-empty__text">{notice}</p>}
        <Link className="nx-btn nx-btn--primary" to={link()}>Ver productos</Link>
      </div>
    );
  }
  const t = totals(fulfillment);
  /** The store asks for an account to pay, and nobody is signed in yet. */
  const needsAccount = store.accountRequired && accountReady && !account;
  /** Terms and privacy notice the customer must accept (when the store publishes them). */
  const legal = (store?.policies ?? []).filter((p) => p.kind !== "returns");
  const below = t.itemsCents < store.minOrderCents;
  const applyCode = async () => {
    if (!code.trim()) return;
    setCheckingCode(true);
    setCodeError(null);
    try {
      setCoupon(await api("POST", `/${slug}/coupons/check`, { code }));
    } catch (e) {
      setCodeError((e as RequestError).message);
    } finally {
      setCheckingCode(false);
    }
  };

  const submit = async () => {
    setPending(true);
    setFields({});
    setMessage(null);
    try {
      const res = await api<{ token: string; number: number; paymentUrl: string | null }>("POST", `/${slug}/orders`, {
        clientId: clientId.current,
        items: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        fulfillment,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        address: fulfillment === "delivery" ? address : null,
        notes: notes || null,
        paymentMethod: payment,
        couponCode: coupon?.code ?? null,
        expectedTotalCents: t.totalCents,
        acceptLegal: accepted,
        legalVersions: legal.length ? { terms: legal.find((p) => p.kind === "terms")?.version ?? null, privacy: legal.find((p) => p.kind === "privacy")?.version ?? null } : null,
      });
      try { localStorage.setItem(SAVED, JSON.stringify({ name, email, phone, address })); } catch { /* ignore */ }
      clear();
      setCoupon(null);
      // Card: straight to Stripe's secure page; it comes back to the order page.
      if (res.paymentUrl) {
        window.location.assign(res.paymentUrl);
        return;
      }
      navigate(link(`/pedido/${res.token}?nuevo=1`), { replace: true });
    } catch (e) {
      const err = e as RequestError;
      if (err.code === "coupon_invalid" || err.code === "coupon_exhausted") {
        setCoupon(null);
        clientId.current = newClientId();
        setMessage(`${err.message} Quitamos el cupón; revisa el total y confirma de nuevo.`);
      } else if (err.code === "price_changed" || err.code === "insufficient_stock" || err.code === "unavailable") {
        // Prices or stock changed: update the cart and let the customer confirm again (with a new id).
        await refresh();
        clientId.current = newClientId();
        setMessage(err.code === "price_changed" ? "Algunos precios cambiaron. Revisa el total y confirma de nuevo." : err.message);
      } else if (err.code === "legal_changed" || err.code === "legal_required") {
        // The store updated its terms: show the new ones and ask again.
        if (err.code === "legal_changed") { await reload().catch(() => {}); setAccepted(false); }
        clientId.current = newClientId();
        setMessage(err.message);
      } else if (err.code === "account_required" || err.code === "not_signed_in") {
        // The session ended (or the store started asking for accounts): sign in again; the cart stays.
        await refreshAccount();
        clientId.current = newClientId();
        setMessage(err.message);
      } else if (err.code === "validation_error") {
        setFields(err.fields);
        setMessage("Revisa los datos marcados.");
      } else setMessage(err.message);
    } finally {
      setPending(false);
    }
  };
  const clear1 = (k: string) => setFields((f) => { if (!f[k]) return f; const n = { ...f }; delete n[k]; return n; });

  return (
    <div className="st-wrap">
      {/* The sign-in form and the order form are siblings: forms cannot nest. */}
      <div className="st-checkout">
        <div>
          <h1 className="st-page-title">Completa tu pedido</h1>
          {notice && <div style={{ marginBottom: 20 }}><Alert tone="warning">{notice}</Alert></div>}
          {message && <div style={{ marginBottom: 20 }}><Alert tone="danger">{message}</Alert></div>}
          {needsAccount ? (
            <section className="st-section" aria-labelledby="checkout-account">
              <h2 className="st-section__title" id="checkout-account">Para pagar, entra a tu cuenta</h2>
              <p className="st-muted" style={{ margin: "0 0 16px" }}>Tu carrito se queda como está. Con tu cuenta ves tus pedidos y la próxima vez compras más rápido.</p>
              <AuthForm mode="register" />
            </section>
          ) : (
          <form id="checkout-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          <section className="st-section">
            <h2 className="st-section__title">Tus datos</h2>
            {account && (
              <p className="st-signed-as">
                Compras como <strong>{account.email}</strong> · <button type="button" className="st-linklike" onClick={() => { void logout(); setEmail(""); }}>No soy yo</button>
              </p>
            )}
            <div className="nx-form-grid">
              <TextField label="Nombre completo" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); clear1("customerName"); }} error={fields.customerName} fieldClassName="nx-span-2" />
              <TextField label="Correo" type="email" autoComplete="email" value={email} disabled={Boolean(account)} onChange={(e) => { setEmail(e.target.value); clear1("customerEmail"); }} error={fields.customerEmail} help="Te enviamos la confirmación y el seguimiento." />
              <TextField label="Teléfono" type="tel" autoComplete="tel" value={phone} onChange={(e) => { setPhone(e.target.value); clear1("customerPhone"); }} error={fields.customerPhone} help="Por si necesitamos contactarte." />
            </div>
          </section>
          <section className="st-section">
            <h2 className="st-section__title">Entrega</h2>
            <div className="st-choices" role="radiogroup" aria-label="Entrega">
              {store.pickupEnabled && (
                <label className="st-choice">
                  <input type="radio" name="fulfillment" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")} />
                  <span className="st-choice__main">
                    <span className="st-choice__title">{FULFILLMENT_LABELS.pickup}</span>
                    <span className="st-choice__text" style={{ display: "block" }}>{[store.pickupAddress, store.pickupInstructions].filter(Boolean).join(" · ") || "Te avisamos cuando esté listo."}</span>
                  </span>
                  <span className="st-choice__side">Gratis</span>
                </label>
              )}
              {store.deliveryEnabled && (
                <label className="st-choice">
                  <input type="radio" name="fulfillment" checked={fulfillment === "delivery"} onChange={() => setFulfillment("delivery")} />
                  <span className="st-choice__main">
                    <span className="st-choice__title">{FULFILLMENT_LABELS.delivery}</span>
                    <span className="st-choice__text" style={{ display: "block" }}>
                      {store.deliveryArea ? `${store.deliveryArea.replace(/\.$/, "")}.` : "Te lo llevamos."}
                      {store.freeDeliveryFromCents !== null && ` Gratis desde ${money(store.freeDeliveryFromCents)}.`}
                    </span>
                  </span>
                  <span className="st-choice__side">{totals("delivery").shippingCents ? money(totals("delivery").shippingCents) : "Gratis"}</span>
                </label>
              )}
            </div>
            {fields.fulfillment && <p className="nx-help" style={{ color: "var(--danger)" }}>{fields.fulfillment}</p>}
            {fulfillment === "delivery" && (
              <div style={{ marginTop: 16 }}>
                <TextAreaField label="Dirección de entrega" rows={3} autoComplete="street-address" value={address} onChange={(e) => { setAddress(e.target.value); clear1("address"); }} error={fields.address} placeholder="Calle y número, colonia, código postal y alguna referencia" />
              </div>
            )}
          </section>
          <section className="st-section">
            <h2 className="st-section__title">Pago</h2>
            <div className="st-choices" role="radiogroup" aria-label="Forma de pago">
              {store.payOnDelivery && (
                <label className="st-choice">
                  <input type="radio" name="payment" checked={payment === "on_delivery"} onChange={() => setPayment("on_delivery")} />
                  <span className="st-choice__main">
                    <span className="st-choice__title">{fulfillment === "pickup" ? "Pagar al recoger" : "Pagar al recibir"}</span>
                    <span className="st-choice__text" style={{ display: "block" }}>En efectivo o con tarjeta.</span>
                  </span>
                </label>
              )}
              {store.transferEnabled && (
                <label className="st-choice">
                  <input type="radio" name="payment" checked={payment === "transfer"} onChange={() => setPayment("transfer")} />
                  <span className="st-choice__main">
                    <span className="st-choice__title">Transferencia bancaria</span>
                    <span className="st-choice__text" style={{ display: "block" }}>Te mostramos los datos al confirmar el pedido.</span>
                  </span>
                </label>
              )}
              {store.cardEnabled && (
                <label className="st-choice">
                  <input type="radio" name="payment" checked={payment === "card"} onChange={() => setPayment("card")} />
                  <span className="st-choice__main">
                    <span className="st-choice__title">Tarjeta de crédito o débito</span>
                    <span className="st-choice__text" style={{ display: "block" }}>Pagas en la página segura de Stripe al confirmar.</span>
                  </span>
                </label>
              )}
            </div>
          </section>
          <section className="st-section">
            <TextAreaField label="Notas para la tienda" optional rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es para regalo, horario preferido…" />
          </section>
          </form>
          )}
        </div>

        <aside className="st-summary" aria-label="Resumen del pedido">
          <div className="st-summary__lines">
            {cart.map((l) => (
              <div className="st-summary__line" key={l.variantId}>
                <div className="st-summary__thumb">
                  {l.image && <img src={imageUrl(l.image)!} alt="" />}
                  <span className="st-summary__qty">{l.quantity}</span>
                </div>
                <div>
                  <div style={{ fontWeight: 500 }}>{l.name}</div>
                  {l.options.length > 0 && <div style={{ color: "var(--ink-muted)" }}>{l.options.join(" / ")}</div>}
                </div>
                <div className="nx-num" style={{ textAlign: "right" }}>
                  {money(Math.round(linePrice(l) * l.quantity))}
                  {linePrice(l) !== l.displayPriceCents && <s className="st-price-was" style={{ display: "block", fontSize: 12 }}>{money(Math.round(l.displayPriceCents * l.quantity))}</s>}
                </div>
              </div>
            ))}
          </div>
          {store.couponsEnabled && (
            coupon ? (
              <div className="st-coupon" style={{ alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
                <span>Cupón <strong className="nx-mono">{coupon.code}</strong></span>
                <button type="button" className="st-line__remove" onClick={() => { setCoupon(null); setCode(""); }}>Quitar</button>
              </div>
            ) : (
              <div className="st-coupon">
                <TextField label="Cupón de descuento" optional value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(null); }} error={codeError ?? undefined} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyCode(); } }} />
                <Button style={{ marginTop: 22 }} loading={checkingCode} onClick={() => void applyCode()}>Aplicar</Button>
              </div>
            )
          )}
          {t.couponError && <p className="nx-help" style={{ color: "var(--warning)", margin: "0 0 12px" }}>{t.couponError}</p>}
          <dl className="st-sum" style={{ margin: 0 }}>
            <div><dt>Productos</dt><dd>{money(t.subtotalCents)}</dd></div>
            {t.discountCents > 0 && <div style={{ color: "var(--accent-text)" }}><dt style={{ color: "inherit" }}>{t.couponDiscountCents ? "Descuentos y cupón" : "Descuentos"}</dt><dd>−{money(t.discountCents)}</dd></div>}
            <div><dt>{fulfillment === "pickup" ? "Recoger en tienda" : "Envío"}</dt><dd>{t.shippingCents ? money(t.shippingCents) : "Gratis"}</dd></div>
            <div className="st-sum__total"><dt>Total</dt><dd>{money(t.totalCents)}</dd></div>
            {t.taxCents > 0 && <div style={{ fontSize: 12 }}><dt>Incluye IVA</dt><dd>{money(t.taxCents)}</dd></div>}
          </dl>
          {below && <p className="nx-help" style={{ color: "var(--warning)", marginTop: 12 }}>El pedido mínimo es de {money(store.minOrderCents)}.</p>}
          <div style={{ marginTop: 20 }}>
            {legal.length > 0 && (
              <label className="st-legal">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>
                  Acepto {legal.map((p, i) => (
                    <span key={p.kind}>{i > 0 && " y "}<Link to={link(`/${POLICY_INFO[p.kind].path}`)} target="_blank">{p.kind === "terms" ? "los términos y condiciones" : "el aviso de privacidad"}</Link></span>
                  ))}.
                </span>
              </label>
            )}
            <Button type="submit" form="checkout-form" variant="primary" size="lg" block loading={pending} disabled={below || !checked || needsAccount || Boolean(t.couponError) || (legal.length > 0 && !accepted)}>{needsAccount ? "Entra a tu cuenta para pagar" : payment === "card" ? "Continuar al pago" : "Confirmar pedido"}</Button>
          </div>
          <p className="nx-help" style={{ marginTop: 12, textAlign: "center" }}>Apartamos tus productos al confirmar.</p>
        </aside>
      </div>
    </div>
  );
}
