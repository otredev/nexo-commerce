// End-to-end test of Phase 6 (SaaS): plans and limits, Stripe subscriptions and Connect card payments,
// custom domains, platform panel, suspension and moving a business to another D1.
// It starts its OWN `wrangler dev` (port 8790, separate local state) wired to mock Stripe and Cloudflare
// servers that run inside this script, so it needs no real keys and does not touch the dev databases.
// Usage: node scripts/smoke-saas.mjs [--keep]   (--keep leaves it running to try the screens)
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "api");
const PORT = 8790, STRIPE_PORT = 12111, CF_PORT = 12112;
const BASE = `http://127.0.0.1:${PORT}`;
const WHSEC = "whsec_smoke_test";
const stamp = Date.now().toString(36).toUpperCase();
const ADMIN_EMAIL = `operador-${stamp}@example.com`.toLowerCase();
let failures = 0;
let seq = 0;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}

/* ---------------- Mock Stripe ---------------- */
const stripe = { customers: [], sessions: new Map(), accounts: new Map(), subscriptions: new Map(), requests: [], failNextSession: false };
const parseForm = (body) => {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
};
const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });

const stripeServer = createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, "http://x");
  const p = req.method === "GET" ? Object.fromEntries(url.searchParams) : parseForm(body);
  const account = req.headers["stripe-account"] ?? null;
  stripe.requests.push({ method: req.method, path: url.pathname, params: p, account, auth: req.headers.authorization });
  // --keep: the screens' walkthrough "pays" a session here (what the customer does on Stripe's page).
  if (url.pathname.startsWith("/__test/")) {
    const s = stripe.sessions.get(url.pathname.split("/").pop());
    if (!s) return json(res, 404, {});
    if (url.pathname.startsWith("/__test/pay/")) Object.assign(s, { status: "complete", payment_status: "paid", payment_intent: `pi_${++seq}` });
    return json(res, 200, { success_url: s.params.success_url, cancel_url: s.params.cancel_url });
  }
  if (req.headers.authorization !== "Bearer sk_test_smoke") return json(res, 401, { error: { message: "bad key" } });
  const m = (re) => url.pathname.match(re);
  let g;
  if (req.method === "POST" && url.pathname === "/v1/customers") {
    const c = { id: `cus_${++seq}`, metadata: { tenant_id: p["metadata[tenant_id]"] } };
    stripe.customers.push(c);
    return json(res, 200, c);
  }
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    if (p.mode === "payment" && stripe.failNextSession) { stripe.failNextSession = false; return json(res, 500, { error: { message: "boom" } }); }
    const id = `cs_${p.mode}_${++seq}`;
    const s = {
      id, mode: p.mode, url: `https://checkout.stripe.test/${id}`, status: "open", payment_status: "unpaid", payment_intent: null, account,
      metadata: { tenant_id: p["metadata[tenant_id]"], order_id: p["metadata[order_id]"] }, params: p,
    };
    stripe.sessions.set(id, s);
    return json(res, 200, s);
  }
  if ((g = m(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/)) && req.method === "POST") {
    const s = stripe.sessions.get(g[1]);
    if (!s || s.account !== account) return json(res, 404, { error: { message: "no such session" } });
    s.status = "expired";
    return json(res, 200, s);
  }
  if ((g = m(/^\/v1\/checkout\/sessions\/([^/]+)$/)) && req.method === "GET") {
    const s = stripe.sessions.get(g[1]);
    if (!s || s.account !== account) return json(res, 404, { error: { message: "no such session" } });
    return json(res, 200, s);
  }
  if ((g = m(/^\/v1\/subscriptions\/([^/]+)$/))) return json(res, 200, stripe.subscriptions.get(g[1]) ?? {});
  if (url.pathname === "/v1/billing_portal/sessions") return json(res, 200, { url: `https://billing.stripe.test/portal/${p.customer}` });
  if (req.method === "POST" && url.pathname === "/v1/accounts") {
    const a = { id: `acct_${++seq}`, charges_enabled: false, metadata: { tenant_id: p["metadata[tenant_id]"] }, type: p.type, country: p.country };
    stripe.accounts.set(a.id, a);
    return json(res, 200, a);
  }
  if ((g = m(/^\/v1\/accounts\/([^/]+)$/))) return json(res, 200, stripe.accounts.get(g[1]) ?? {});
  if (url.pathname === "/v1/account_links") return json(res, 200, { url: `https://connect.stripe.test/onboarding/${p.account}` });
  json(res, 404, { error: { message: `mock: ${req.method} ${url.pathname}` } });
});

/* ---------------- Mock Cloudflare (custom hostnames) ---------------- */
const cf = { hostnames: new Map(), deleted: [] };
const cfServer = createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, "http://x");
  if (req.headers.authorization !== "Bearer cf_smoke") return json(res, 403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
  let g;
  if (req.method === "POST" && url.pathname === "/zones/zone_smoke/custom_hostnames") {
    const { hostname } = JSON.parse(body);
    if ([...cf.hostnames.values()].some((h) => h.hostname === hostname)) return json(res, 409, { success: false, errors: [{ code: 1406, message: "Duplicate custom hostname found." }] });
    const h = {
      id: `ch_${++seq}`, hostname, status: "pending",
      ownership_verification: { type: "txt", name: `_cf-custom-hostname.${hostname}`, value: "own-123" },
      ssl: { status: "pending_validation", validation_records: [{ txt_name: `_acme-challenge.${hostname}`, txt_value: "acme-456" }] },
    };
    cf.hostnames.set(h.id, h);
    return json(res, 200, { success: true, result: h });
  }
  if ((g = url.pathname.match(/^\/zones\/zone_smoke\/custom_hostnames\/([^/]+)$/))) {
    const h = cf.hostnames.get(g[1]);
    if (!h) return json(res, 404, { success: false, errors: [{ code: 1436, message: "Not found" }] });
    if (req.method === "DELETE") { cf.hostnames.delete(g[1]); cf.deleted.push(h.hostname); return json(res, 200, { success: true, result: { id: h.id } }); }
    return json(res, 200, { success: true, result: h });
  }
  json(res, 404, { success: false, errors: [{ code: 0, message: "mock route" }] });
});
const activate = (hostname) => {
  const h = [...cf.hostnames.values()].find((x) => x.hostname === hostname);
  h.status = "active";
  h.ssl = { status: "active", validation_records: [] };
};

/* ---------------- Worker with its own state ---------------- */
try { await fetch(`${BASE}/api/health`); throw new Error(`Port ${PORT} is busy: stop the previous run first`); } catch (e) { if (String(e.message).startsWith("Port")) throw e; }
await new Promise((ok) => stripeServer.listen(STRIPE_PORT, "127.0.0.1", ok));
await new Promise((ok) => cfServer.listen(CF_PORT, "127.0.0.1", ok));
const state = mkdtempSync(join(tmpdir(), "nexo-saas-"));
for (const db of ["DB_CONTROL", "DB_TENANT_DEFAULT", "DB_TENANT_2"]) {
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", db, "--local", "--persist-to", state], { cwd: API_DIR, stdio: "ignore", env: { ...process.env, CI: "1" } });
}
const vars = {
  STRIPE_SECRET_KEY: "sk_test_smoke", STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_BUSINESS: "price_business",
  STRIPE_APPLICATION_FEE_BPS: "150", STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`,
  CF_API_TOKEN: "cf_smoke", CF_ZONE_ID: "zone_smoke", CF_API_BASE: `http://127.0.0.1:${CF_PORT}`, STORE_CNAME_TARGET: "tiendas.nexo.test",
};
const worker = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", state, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { cwd: API_DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" }, detached: true });
let log = "";
worker.stdout.on("data", (d) => (log += d));
worker.stderr.on("data", (d) => (log += d));
let down = false;
const shutdown = () => {
  if (down) return;
  down = true;
  // npx starts wrangler, which starts workerd: stop the whole process group.
  try { process.kill(-worker.pid, "SIGTERM"); } catch { /* already gone */ }   stripeServer.close();
  cfServer.close();
  try { rmSync(state, { recursive: true, force: true }); } catch { /* ignore */ }
};
process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("uncaughtException", (e) => { console.error(e); shutdown(); process.exit(1); });
for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
  if (i > 120) { console.log(log.slice(-3000)); throw new Error("wrangler dev did not start"); }
  await new Promise((ok) => setTimeout(ok, 500));
}

function client() {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const h = { ...headers, ...(cookie ? { cookie } : {}) };
    let payload;
    if (body !== undefined) { h["content-type"] = "application/json"; payload = typeof body === "string" ? body : JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
}
const webhook = async (event, { secret = WHSEC, t = Math.floor(Date.now() / 1000) } = {}) => {
  const body = JSON.stringify(event);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return client()("POST", "/api/webhooks/stripe", body, { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" });
};
let evt = 0;
const subEvent = (type, tenantId, { status = "active", price = "price_pro", customer, id = "sub_1" } = {}) => {
  const sub = { id, object: "subscription", customer, status, metadata: { tenant_id: tenantId }, items: { data: [{ price: { id: price }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } };
  stripe.subscriptions.set(id, sub);
  return { id: `evt_${stamp}_${++evt}`, type, data: { object: sub } };
};

const pwd = "contrasena-segura-1";
const owner = client(), admin = client(), shopper = client(), rival = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Nube ${stamp}`, ownerName: "Nora Dueña", email: `nora-${stamp}@example.com`, password: pwd });
const tenantId = r.data.tenant.id, slug = r.data.tenant.slug;
// The platform operator has their own account (no business), created as scripts/crear-operador.mjs would.
await admin("POST", "/api/dev/operator", { email: ADMIN_EMAIL, name: "Óscar Operador", password: pwd });
await admin("POST", "/api/platform/auth/login", { email: ADMIN_EMAIL, password: pwd });
await rival("POST", "/api/auth/register", { businessName: `Rival ${stamp}`, ownerName: "Rita", email: `rita-${stamp}@example.com`, password: pwd });

/* ---------------- Plans and limits ---------------- */
console.log("Planes y límites");
r = await owner("GET", "/api/billing");
check("negocio nuevo en plan Gratis con su uso", r.status === 200 && r.data.plan === "free" && r.data.billingAvailable && r.data.usage.users === 1 && r.data.usage.locations === 1, r.data);
r = await owner("GET", "/api/me");
check("/me trae plan y estado del negocio", r.data.tenant.plan === "free" && r.data.tenant.status === "active" && !("platformAdmin" in r.data), r.data);
r = await owner("POST", "/api/locations", { name: "Bodega", type: "warehouse", address: null, active: true, isDefault: false });
check("segunda ubicación en Gratis → 402", r.status === 402 && r.data.error.code === "plan_limit" && /1 ubicación/.test(r.data.error.message), r.data);
r = await owner("POST", "/api/locations", { name: "Bodega inactiva", type: "warehouse", address: null, active: false, isDefault: false });
check("una ubicación inactiva no cuenta", r.status === 201, r.data);
const bodega = r.data.id;
r = await owner("PUT", `/api/locations/${bodega}`, { name: "Bodega inactiva", type: "warehouse", address: null, active: true, isDefault: false });
check("activarla excede el plan → 402", r.status === 402, r.data);
r = await owner("POST", "/api/users", { name: "Carlos Cajero", email: `carlos-${stamp}@example.com`, password: pwd, role: "cashier" });
check("segundo usuario cabe en Gratis", r.status === 201, r.data);
const cashierId = r.data.userId;
r = await owner("POST", "/api/users", { name: "Tercero", email: `tercero-${stamp}@example.com`, password: pwd, role: "cashier" });
check("tercer usuario → 402", r.status === 402 && r.data.error.fields.limit === "users", r.data);
await owner("PATCH", `/api/users/${cashierId}`, { active: false });
r = await owner("POST", "/api/users", { name: "Tercero", email: `tercero-${stamp}@example.com`, password: pwd, role: "cashier" });
check("un usuario desactivado libera su lugar", r.status === 201, r.data);
r = await owner("PATCH", `/api/users/${cashierId}`, { active: true });
check("reactivar excede el plan → 402", r.status === 402, r.data);
// Products: 100 in the free plan. Four imports of 25 fill it.
for (let b = 0; b < 4; b++) {
  await owner("POST", "/api/products/import", { products: Array.from({ length: 25 }, (_, i) => ({ name: `Producto ${b}-${i}`, variants: [{ priceCents: 1000 }], rows: [i + 2] })) });
}
r = await owner("GET", "/api/billing");
check("100 productos importados", r.data.usage.products === 100, r.data.usage);
r = await owner("POST", "/api/products/import", { products: [{ name: "Extra 1", variants: [{ priceCents: 1000 }], rows: [2] }] });
check("importar más allá del límite reporta el error por fila", r.status === 200 && r.data.created === 0 && /límite/.test(r.data.errors[0]?.message ?? ""), r.data);
r = await owner("POST", "/api/products", { name: "Uno más", variants: [{ priceCents: 1000 }] });
check("crear producto 101 → 402", r.status === 402 && r.data.error.fields.limit === "products", r.data);

/* ---------------- Subscription (Stripe Billing) ---------------- */
console.log("Suscripción con Stripe");
const cashier = client();
await cashier("POST", "/api/auth/login", { email: `tercero-${stamp}@example.com`, password: pwd });
r = await cashier("POST", "/api/billing/checkout", { plan: "pro" });
check("solo el propietario contrata → 403", r.status === 403, r.data);
r = await owner("POST", "/api/billing/checkout", { plan: "enterprise" });
check("plan inexistente → 422", r.status === 422 || r.status === 400, r.data);
r = await owner("POST", "/api/billing/checkout", { plan: "pro" });
const subSession = [...stripe.sessions.values()].find((s) => s.mode === "subscription");
check("checkout de suscripción → URL de Stripe", r.status === 200 && r.data.url.startsWith("https://checkout.stripe.test/"), r.data);
check("crea el cliente en Stripe con el negocio en metadata", stripe.customers.length === 1 && stripe.customers[0].metadata.tenant_id === tenantId, stripe.customers);
check("la sesión pide el precio Pro y vuelve a Configuración › Plan",
  subSession?.params["line_items[0][price]"] === "price_pro" && subSession.params["subscription_data[metadata][tenant_id]"] === tenantId && subSession.params.success_url.endsWith("/configuracion?tab=plan&pago=ok"), subSession?.params);
await owner("POST", "/api/billing/checkout", { plan: "pro" });
check("un segundo intento reutiliza el cliente", stripe.customers.length === 1, stripe.customers.length);
const customer = stripe.customers[0].id;

r = await webhook(subEvent("customer.subscription.created", tenantId, { customer }), { secret: "whsec_otro" });
check("webhook con firma equivocada → 400", r.status === 400, r.data);
r = await webhook(subEvent("customer.subscription.created", tenantId, { customer }), { t: Math.floor(Date.now() / 1000) - 3600 });
check("webhook viejo (reenvío) → 400", r.status === 400, r.data);
const created = subEvent("customer.subscription.created", tenantId, { customer });
r = await webhook(created);
check("suscripción creada → 200", r.status === 200 && r.data.duplicate === false, r.data);
r = await webhook(created);
check("el mismo evento dos veces se aplica una vez", r.status === 200 && r.data.duplicate === true, r.data);
r = await owner("GET", "/api/billing");
check("plan Pro activo con renovación", r.data.plan === "pro" && r.data.planStatus === "active" && r.data.hasSubscription && r.data.periodEnd, r.data);
r = await owner("POST", "/api/billing/checkout", { plan: "business" });
check("con suscripción, cambiar de plan va por el portal → 409", r.status === 409 && r.data.error.code === "has_subscription", r.data);
r = await owner("POST", "/api/billing/portal");
check("portal del cliente", r.status === 200 && r.data.url.endsWith(customer), r.data);
r = await owner("PUT", `/api/locations/${bodega}`, { name: "Bodega", type: "warehouse", address: null, active: true, isDefault: false });
check("en Pro ya cabe la segunda ubicación", r.status === 200, r.data);
r = await owner("PATCH", `/api/users/${cashierId}`, { active: true });
check("y el tercer usuario", r.status === 200, r.data);
r = await webhook(subEvent("customer.subscription.updated", tenantId, { customer, status: "past_due" }));
r = await owner("GET", "/api/billing");
check("pago fallido: conserva Pro como «pago pendiente»", r.data.plan === "pro" && r.data.planStatus === "past_due", r.data);
r = await webhook(subEvent("customer.subscription.deleted", tenantId, { customer, status: "canceled" }));
r = await owner("GET", "/api/billing");
check("suscripción cancelada → vuelve a Gratis", r.data.plan === "free" && r.data.planStatus === "canceled" && !r.data.hasSubscription, r.data);
r = await owner("POST", "/api/locations", { name: "Sucursal 3", type: "warehouse", address: null, active: true, isDefault: false });
check("bajar de plan conserva lo que hay pero no deja agregar más", r.status === 402, r.data);
// Checkout completed (subscription) reads the subscription right away.
stripe.subscriptions.set("sub_2", { id: "sub_2", customer, status: "active", metadata: { tenant_id: tenantId }, items: { data: [{ price: { id: "price_business" }, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30 }] } });
r = await webhook({ id: `evt_${stamp}_${++evt}`, type: "checkout.session.completed", data: { object: { id: "cs_x", mode: "subscription", subscription: "sub_2", customer } } });
r = await owner("GET", "/api/billing");
check("checkout completado activa el plan Negocio al instante", r.data.plan === "business" && r.data.planStatus === "active", r.data);

/* ---------------- Stripe Connect + card payments ---------------- */
console.log("Pagos con tarjeta (Stripe Connect)");
r = await owner("GET", "/api/billing/connect");
check("sin cuenta de Stripe todavía", r.status === 200 && r.data.available && !r.data.accountId && r.data.planAllows, r.data);
const product = (await owner("POST", "/api/products", { name: "Lámpara", online: true, variants: [{ sku: `LAM-${stamp}`, priceCents: 50000, initialStock: 5 }] })).data;
const lamp = product.variants[0].id;
const locs = (await owner("GET", "/api/locations")).data;
const main = locs.find((l) => l.isDefault).id;
const settings = (await owner("GET", "/api/store-settings")).data;
for (const k of ["slug", "url", "publishedCount", "activeCount"]) delete settings[k];
const storeConfig = { ...settings, enabled: true, locationId: main, payOnDelivery: true, holdHours: 48 };
r = await owner("PUT", "/api/store-settings", { ...storeConfig, cardEnabled: true });
check("activar tarjeta sin Stripe conectado → 422", r.status === 422 && r.data.error.fields.cardEnabled, r.data);
r = await cashier("POST", "/api/billing/connect");
check("solo el propietario conecta Stripe → 403", r.status === 403, r.data);
r = await owner("POST", "/api/billing/connect");
const acct = [...stripe.accounts.keys()][0];
check("conectar crea la cuenta Standard (MX) y da el enlace de alta", r.status === 200 && r.data.url.endsWith(acct) && stripe.accounts.get(acct).type === "standard" && stripe.accounts.get(acct).country === "MX", r.data);
r = await owner("POST", "/api/billing/connect");
check("volver a conectar reutiliza la cuenta", stripe.accounts.size === 1, stripe.accounts.size);
r = await owner("GET", "/api/billing/connect?refresh=1");
check("Stripe aún no habilita cobros", r.data.accountId === acct && !r.data.chargesEnabled, r.data);
stripe.accounts.get(acct).charges_enabled = true;
r = await owner("GET", "/api/billing/connect?refresh=1");
check("al volver del alta se consulta a Stripe", r.data.chargesEnabled === true, r.data);
r = await webhook({ id: `evt_${stamp}_${++evt}`, type: "account.updated", account: acct, data: { object: { id: acct, charges_enabled: false } } });
r = await owner("GET", "/api/billing/connect");
check("account.updated desactiva cobros", r.data.chargesEnabled === false, r.data);
await webhook({ id: `evt_${stamp}_${++evt}`, type: "account.updated", account: acct, data: { object: { id: acct, charges_enabled: true } } });
r = await owner("PUT", "/api/store-settings", { ...storeConfig, cardEnabled: true });
check("activar pago con tarjeta en la tienda", r.status === 200 && r.data.cardEnabled === true, r.data);
r = await shopper("GET", `/api/store/${slug}`);
check("la tienda ofrece tarjeta", r.status === 200 && r.data.cardEnabled === true, r.data);

const stockOf = async () => (await owner("GET", `/api/products/${product.id}`)).data.variants[0].stock;
const cid = () => `saas-${stamp}-${++seq}`;
async function place(quantity, extra = {}, headers = {}) {
  const body = { clientId: cid(), items: [{ variantId: lamp, quantity }], fulfillment: "pickup", customerName: "Iván Cliente", customerEmail: `ivan-${stamp}@example.com`, customerPhone: "5512345678", address: null, notes: null, paymentMethod: "card", expectedTotalCents: 0, ...extra };
  const first = await shopper("POST", `/api/store/${slug}/orders`, body, headers);
  if (first.status !== 409 || first.data.error.code !== "price_changed") return first;
  return shopper("POST", `/api/store/${slug}/orders`, { ...body, expectedTotalCents: Number(first.data.error.fields.expectedTotalCents) }, headers);
}
r = await place(2);
const o1 = r.data;
const s1 = [...stripe.sessions.values()].find((s) => s.metadata.order_id && s.mode === "payment");
check("pedido con tarjeta → 201 con enlace de pago", r.status === 201 && o1.paymentUrl === s1?.url, r.data);
check("la sesión va a la cuenta del negocio por el total, con comisión de la plataforma",
  s1?.account === acct && Number(s1.params["line_items[0][price_data][unit_amount]"]) === 100000 && s1.params["payment_intent_data[application_fee_amount]"] === "1500" && s1.params["line_items[0][price_data][currency]"] === "mxn", s1?.params);
check("regresa a la página del pedido", s1?.params.success_url.endsWith(`/${slug}/pedido/${o1.token}?pago=ok`), s1?.params.success_url);
check("aparta las existencias", (await stockOf()) === 3, await stockOf());
r = await shopper("GET", `/api/store/${slug}/orders/${o1.token}`);
check("el pedido espera el pago", r.data.paymentMethod === "card" && r.data.awaitingCardPayment === true && r.data.paymentStatus === "pending", r.data);
r = await shopper("POST", `/api/store/${slug}/orders/${o1.token}/pay`);
check("«Pagar con tarjeta» devuelve la sesión abierta", r.status === 200 && r.data.url === s1.url, r.data);
r = await shopper("POST", `/api/store/${slug}/orders/${o1.token}/payment-status`);
check("sin pagar sigue pendiente", r.data.paymentStatus === "pending", r.data);
Object.assign(s1, { status: "complete", payment_status: "paid", payment_intent: "pi_123" });
r = await shopper("POST", `/api/store/${slug}/orders/${o1.token}/payment-status`);
check("al volver de Stripe se marca pagado", r.status === 200 && r.data.paymentStatus === "paid" && !r.data.awaitingCardPayment, r.data);
r = await webhook({ id: `evt_${stamp}_${++evt}`, type: "checkout.session.completed", account: acct, data: { object: s1 } });
const orders = (await owner("GET", "/api/orders?status=all")).data;
const adminOrder = orders.items.find((o) => o.number === o1.number);
r = await owner("GET", `/api/orders/${adminOrder.id}`);
check("el panel lo ve pagado con tarjeta y referencia de Stripe", r.data.paymentStatus === "paid" && r.data.paidMethod === "card" && r.data.paidReference === "pi_123", r.data);
r = await owner("GET", "/api/audit?entity=order&limit=200");
const paidLogs = r.data.items.filter((a) => a.action === "order.paid" && a.entityId === adminOrder.id);
check("el webhook después del regreso no duplica el pago", paidLogs.length === 1, paidLogs.length);

r = await place(1);
const o2 = r.data;
const s2 = [...stripe.sessions.values()].find((s) => s.metadata.order_id && s.url === o2.paymentUrl);
r = await webhook({ id: `evt_${stamp}_${++evt}`, type: "checkout.session.expired", account: "acct_ajena", data: { object: { ...s2, status: "expired" } } });
r = await shopper("GET", `/api/store/${slug}/orders/${o2.token}`);
check("un evento de otra cuenta de Stripe se ignora", r.data.status === "pending", r.data.status);
r = await webhook({ id: `evt_${stamp}_${++evt}`, type: "checkout.session.expired", account: acct, data: { object: { ...s2, status: "expired" } } });
r = await shopper("GET", `/api/store/${slug}/orders/${o2.token}`);
check("sesión vencida sin pagar → pedido cancelado", r.data.status === "cancelled" && /pago con tarjeta/.test(r.data.cancelReason), r.data);
check("y las existencias regresan", (await stockOf()) === 3, await stockOf());

r = await place(1);
const o3 = r.data;
const s3 = [...stripe.sessions.values()].find((s) => s.url === o3.paymentUrl);
r = await shopper("POST", `/api/store/${slug}/orders/${o3.token}/cancel`);
check("el cliente cancela antes de pagar y se cierra la página de Stripe", r.status === 200 && r.data.status === "cancelled" && s3.status === "expired", { status: r.data.status, s: s3?.status });
r = await shopper("POST", `/api/store/${slug}/orders/${o3.token}/pay`);
check("ya no se puede pagar → 409", r.status === 409, r.data);

stripe.failNextSession = true;
r = await place(1);
check("si Stripe falla, el pedido no queda apartado → 502", r.status === 502 && r.data.error.code === "stripe_error", r.data);
check("las existencias siguen completas", (await stockOf()) === 3, await stockOf());

/* ---------------- Custom domains ---------------- */
console.log("Dominio propio");
const host = `tienda-${stamp.toLowerCase()}.cliente.mx`;
r = await owner("PUT", "/api/store-settings/domain", { hostname: "no es dominio" });
check("dominio no válido → 422", r.status === 422 || r.status === 400, r.data);
r = await owner("PUT", "/api/store-settings/domain", { hostname: "tiendas.nexo.test" });
check("el dominio de la plataforma no se puede usar", r.status === 422, r.data);
r = await owner("PUT", "/api/store-settings/domain", { hostname: host.toUpperCase() });
check("agregar dominio → pendiente con registros DNS", r.status === 201 && r.data.hostname === host && r.data.status === "pending" && r.data.target === "tiendas.nexo.test" && r.data.verification.length === 2, r.data);
r = await client()("GET", `/api/store-host/${host}`);
check("mientras está pendiente no resuelve la tienda", r.status === 404, r.data);
r = await rival("PUT", "/api/store-settings/domain", { hostname: host });
check("otro negocio no puede tomarlo", r.status === 402 || r.status === 409, r.data);
activate(host);
r = await owner("GET", "/api/store-settings/domain?refresh=1");
check("comprobar ahora → activo", r.data.domain.status === "active" && r.data.domain.sslStatus === "active" && r.data.domain.verification.length === 0, r.data);
r = await client()("GET", `/api/store-host/${host}`);
check("el dominio resuelve la tienda", r.status === 200 && r.data.slug === slug, r.data);
r = await place(1, {}, { origin: `https://${host}` });
const s4 = [...stripe.sessions.values()].find((s) => s.url === r.data.paymentUrl);
check("desde el dominio propio, Stripe regresa a ese dominio", s4?.params.success_url.startsWith(`https://${host}/pedido/`), s4?.params.success_url);
r = await place(1, {}, { origin: "https://phishing.example.com" });
const s5 = [...stripe.sessions.values()].find((s) => s.url === r.data.paymentUrl);
check("un origen ajeno usa la dirección normal de la tienda", s5?.params.success_url.includes(`/${slug}/pedido/`) && !s5.params.success_url.includes("phishing"), s5?.params.success_url);
r = await owner("DELETE", "/api/store-settings/domain");
check("quitar dominio lo borra de Cloudflare", r.status === 204 && cf.deleted.includes(host), cf.deleted);
r = await client()("GET", `/api/store-host/${host}`);
check("y deja de resolver", r.status === 404, r.data);

/* ---------------- Platform panel and suspension ---------------- */
console.log("Panel de plataforma y suspensión");
r = await owner("GET", "/api/platform/tenants");
check("una sesión de negocio no entra a la plataforma (401)", r.status === 401, r.data);
r = await admin("GET", "/api/platform/me");
check("el operador entra con su propia cuenta", r.status === 200 && r.data.operator.email === ADMIN_EMAIL, r.data);
r = await admin("GET", `/api/platform/tenants?q=${encodeURIComponent(`Nube ${stamp}`)}`);
check("lista de negocios con propietario y plan", r.status === 200 && r.data.items.length === 1 && r.data.items[0].owner.email === `nora-${stamp}@example.com`.toLowerCase() && r.data.items[0].plan === "business" && r.data.totals.total >= 2, r.data);
r = await admin("GET", `/api/platform/tenants/${tenantId}`);
check("detalle con uso, pedidos y bases disponibles", r.status === 200 && r.data.usage.products === 101 && r.data.usage.orders30d >= 5 && r.data.availableBindings.includes("DB_TENANT_2") && r.data.stripeAccountId === acct, r.data);
r = await admin("PATCH", `/api/platform/tenants/${tenantId}`, { status: "suspended", suspendedReason: "Pago vencido" });
check("suspender negocio", r.status === 200 && r.data.status === "suspended" && r.data.suspendedReason === "Pago vencido", r.data);
r = await owner("GET", "/api/products");
check("suspendido: el panel responde 403 tenant_suspended", r.status === 403 && r.data.error.code === "tenant_suspended" && /Pago vencido/.test(r.data.error.message), r.data);
r = await owner("GET", "/api/me");
check("pero /me funciona y dice por qué", r.status === 200 && r.data.tenant.status === "suspended" && r.data.tenant.suspendedReason === "Pago vencido", r.data);
r = await owner("POST", "/api/billing/portal");
check("y puede abrir el portal para pagar", r.status === 200, r.data);
r = await shopper("GET", `/api/store/${slug}`);
check("la tienda suspendida no se muestra", r.status === 404, r.data);
const again = client();
r = await again("POST", "/api/auth/login", { email: `nora-${stamp}@example.com`, password: pwd });
check("puede iniciar sesión para ver el aviso", r.status === 200, r.data);
r = await admin("PATCH", `/api/platform/tenants/${tenantId}`, { status: "active" });
r = await owner("GET", "/api/products?pageSize=1");
check("reactivar devuelve el acceso", r.status === 200, r.data);
r = await admin("PATCH", `/api/platform/tenants/${(await rival("GET", "/api/me")).data.tenant.id}`, { plan: "pro" });
check("plan de cortesía puesto a mano", r.status === 200 && r.data.plan === "pro", r.data);
r = await rival("GET", "/api/billing");
check("el negocio lo ve", r.data.plan === "pro", r.data);

/* ---------------- Move a business to another D1 ---------------- */
console.log("Mover un negocio a otra base de datos");
const before = { products: (await owner("GET", "/api/billing")).data.usage.products, orders: (await owner("GET", "/api/orders?status=all")).data.items.length, stock: await stockOf() };
r = await admin("POST", `/api/platform/tenants/${tenantId}/move`, { binding: "DB_TENANT_DEFAULT" });
check("mover a la misma base → 409", r.status === 409, r.data);
r = await admin("POST", `/api/platform/tenants/${tenantId}/move`, { binding: "DB_TENANT_9" });
check("base inexistente → 422", r.status === 422, r.data);
r = await admin("POST", `/api/platform/tenants/${tenantId}/move`, { binding: "DB_TENANT_2" });
check("mover a DB_TENANT_2", r.status === 200 && r.data.result.to === "DB_TENANT_2" && r.data.result.rows > 200 && r.data.tenant.dbBinding === "DB_TENANT_2" && r.data.tenant.status === "active", r.data.result ?? r.data);
const after = { products: (await owner("GET", "/api/billing")).data.usage.products, orders: (await owner("GET", "/api/orders?status=all")).data.items.length, stock: await stockOf() };
check("la sesión sigue y los datos son los mismos", JSON.stringify(before) === JSON.stringify(after), { before, after });
r = await shopper("GET", `/api/store/${slug}/orders/${o1.token}`);
check("la tienda y el seguimiento siguen funcionando", r.status === 200 && r.data.paymentStatus === "paid", r.data);
r = await place(1);
check("y recibe pedidos nuevos en la nueva base", r.status === 201, r.data);
r = await owner("POST", "/api/products", { name: "Después de mudarse", variants: [{ priceCents: 1000 }] });
check("el panel escribe en la nueva base", r.status === 201, r.data);
r = await admin("POST", `/api/platform/tenants/${tenantId}/move`, { binding: "DB_TENANT_DEFAULT" });
check("y de regreso (la base anterior quedó limpia)", r.status === 200 && r.data.tenant.dbBinding === "DB_TENANT_DEFAULT", r.data.result ?? r.data);
r = await owner("GET", "/api/billing");
check("con todo su catálogo", r.data.usage.products === before.products + 1, r.data.usage);
r = await rival("GET", "/api/products?pageSize=1");
check("los demás negocios no se enteran", r.status === 200, r.data);
r = await client()("POST", "/api/dev/backup");
check("el respaldo incluye todas las bases de negocios", r.status === 200 && r.data.tables > 40, r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
if (process.argv.includes("--keep")) {
  // Leaves the Worker and the mocks running to try the screens: http://127.0.0.1:8790
  console.log(`\nServidor de prueba en ${BASE} (Ctrl+C para salir)`);
  console.log(`  Negocio: nora-${stamp}@example.com / ${pwd}`.toLowerCase());
  console.log(`  Operador (/admin): ${ADMIN_EMAIL} / ${pwd}`);
  globalThis.__mocks = { stripe, cf, activate };
} else {
  shutdown();
  process.exit(failures ? 1 : 0);
}
