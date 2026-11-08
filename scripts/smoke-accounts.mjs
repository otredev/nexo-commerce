// End-to-end test of customer accounts in the online store against a running API in development:
// sign-up creates (or links) the customer in Clientes, the cart needs no account but paying does,
// "Mis pedidos", profile, password, reset, lockout and isolation between stores.
//   node scripts/smoke-accounts.mjs [http://localhost:8787]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}

/** A browser that keeps cookies per path, like a real one (the customer cookie lives on /api/store/<slug>). */
function client(ip) {
  const jar = new Map(); // name|path → { value, path }
  const call = async (method, path, body, headers = {}) => {
    const h = { ...headers, ...(ip ? { "cf-connecting-ip": ip } : {}) };
    const cookies = [...jar.values()].filter((c) => path.startsWith(c.path)).map((c) => `${c.name}=${c.value}`);
    if (cookies.length) h.cookie = cookies.join("; ");
    let payload;
    if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(";").map((x) => x.trim());
      const [name, ...v] = pair.split("=");
      const cpath = attrs.find((a) => /^path=/i.test(a))?.slice(5) ?? "/";
      const expired = attrs.some((a) => /^max-age=0$/i.test(a) || /expires=thu, 01 jan 1970/i.test(a)) || !v.join("=");
      if (expired) jar.delete(`${name}|${cpath}`); else jar.set(`${name}|${cpath}`, { name, value: v.join("="), path: cpath, raw });
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  call.jar = jar;
  return call;
}

const pwd = "contrasena-segura-1";
const owner = client(), other = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Dulcería ${stamp}`, ownerName: "Dora Dueña", email: `dora-${stamp}@example.com`, password: pwd });
const slug = r.data.tenant.slug;
await other("POST", "/api/auth/register", { businessName: `Vecino ${stamp}`, ownerName: "Víctor", email: `victor-${stamp}@example.com`, password: pwd });
const otherSlug = (await other("GET", "/api/me")).data.tenant.slug;
const main = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;
const mainOther = (await other("GET", "/api/locations")).data.find((l) => l.isDefault).id;
const prod = (await owner("POST", "/api/products", { name: `Cajeta ${stamp}`, online: true, variants: [{ priceCents: 8000, initialStock: 20 }] })).data;
const variantId = prod.variants[0].id;
let settings = (await owner("GET", "/api/store-settings")).data;
check("«Pedir cuenta para comprar» viene activado", settings.accountRequired === true, settings.accountRequired);
r = await owner("PUT", "/api/store-settings", { ...settings, enabled: true, locationId: main, pickupEnabled: true, deliveryEnabled: true, payOnDelivery: true });
check("la tienda se publica", r.status === 200 && r.data.accountRequired === true, r.data);
await other("PUT", "/api/store-settings", { ...(await other("GET", "/api/store-settings")).data, enabled: true, locationId: mainOther, pickupEnabled: true, payOnDelivery: true });
// A customer the business already had at the register (POS), same email as a future sign-up.
r = await owner("POST", "/api/customers", { name: "Paula Mostrador", email: `paula-${stamp}@example.com`, phone: null, taxId: null, address: "Calle del mostrador 1", notes: "Cliente frecuente", acceptsMarketing: false });
const posCustomerId = r.data.id;

const shopper = client(`10.1.0.${Math.floor(Math.random() * 200) + 1}`);
const order = (extra = {}) => ({
  clientId: `acc-${stamp}-${Math.random().toString(36).slice(2)}`, items: [{ variantId, quantity: 1 }], fulfillment: "pickup",
  customerName: "Ana Compradora", customerEmail: `ana-${stamp}@example.com`, customerPhone: "5511223344", address: null, notes: null, paymentMethod: "on_delivery", expectedTotalCents: 8000, ...extra,
});

/* ---------------- Browsing and the cart need no account ---------------- */
console.log("Sin cuenta");
r = await shopper("GET", `/api/store/${slug}`);
check("la tienda dice que pagar pide cuenta", r.status === 200 && r.data.accountRequired === true, r.data.accountRequired);
r = await shopper("GET", `/api/store/${slug}/products/${prod.id}`);
check("se puede ver el producto sin cuenta", r.status === 200, r.status);
r = await shopper("GET", `/api/store/${slug}/account`);
check("/account sin sesión → null (sin error)", r.status === 200 && r.data.account === null && /no-store/.test(r.headers.get("cache-control") ?? ""), r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, order());
check("pagar sin cuenta → 401 account_required", r.status === 401 && r.data.error.code === "account_required", r.data);

/* ---------------- Sign-up ---------------- */
console.log("Crear cuenta");
r = await shopper("POST", `/api/store/${slug}/account/register`, { name: "Ana Compradora", email: "no-es-correo", password: "corta" });
check("datos inválidos → 422 por campo", r.status === 422 && r.data.error.fields.email && r.data.error.fields.password, r.data);
r = await shopper("POST", `/api/store/${slug}/account/register`, { name: "Ana Compradora", email: `ANA-${stamp}@Example.com`, password: pwd, phone: "55 1122 3344", acceptsMarketing: true });
const cookie = [...shopper.jar.values()].find((c) => c.name === "nx_customer");
check("crear cuenta → 201 y sesión", r.status === 201 && r.data.account.email === `ana-${stamp}@example.com`.toLowerCase() && r.data.account.acceptsMarketing === true, r.data);
check("cookie HttpOnly limitada a esta tienda", cookie && cookie.path === `/api/store/${slug}` && /httponly/i.test(cookie.raw) && /samesite=lax/i.test(cookie.raw), cookie?.raw);
r = await shopper("GET", `/api/store/${slug}/account`);
check("/account con sesión", r.data.account?.name === "Ana Compradora", r.data);
r = await owner("GET", `/api/customers?q=${encodeURIComponent(`ana-${stamp}`)}`);
const anaCustomer = r.data.items[0];
check("aparece en Clientes, desde la tienda, con cuenta", r.data.items.length === 1 && anaCustomer.source === "online" && anaCustomer.accountSince && anaCustomer.acceptsMarketing === true && anaCustomer.phone === "5511223344", anaCustomer);
r = await owner("GET", "/api/audit");
check("y en la Actividad del negocio", (r.data.items ?? r.data).some((a) => a.action === "customer.signup" && a.entityId === anaCustomer.id), (r.data.items ?? r.data).slice(0, 2));
r = await client()("POST", `/api/store/${slug}/account/register`, { name: "Otra Ana", email: `ana-${stamp}@example.com`, password: pwd });
check("el mismo correo otra vez → 409", r.status === 409 && r.data.error.code === "email_taken" && r.data.error.fields.email, r.data);

const paula = client();
r = await paula("POST", `/api/store/${slug}/account/register`, { name: "Paula P.", email: `paula-${stamp}@example.com`, password: pwd, phone: "5599887766" });
check("con el correo de un cliente que ya existía: crea la cuenta", r.status === 201, r.data);
r = await owner("GET", `/api/customers/${posCustomerId}`);
check("se liga al mismo cliente, sin cambiarle el nombre ni lo que ya tenía", r.data.accountSince && r.data.name === "Paula Mostrador" && r.data.notes === "Cliente frecuente" && r.data.phone === "5599887766" && r.data.address === "Calle del mostrador 1", r.data);
r = await owner("GET", `/api/customers?q=${encodeURIComponent(`paula-${stamp}`)}`);
check("sin duplicarlo", r.data.items.length === 1, r.data.items.map((c) => c.name));

/* ---------------- Paying with the account ---------------- */
console.log("Pagar con la cuenta");
r = await shopper("POST", `/api/store/${slug}/orders`, order({ customerEmail: "otro-correo@example.com", customerPhone: "5500001111" }));
const placed = r.data;
check("con sesión, el pedido se crea", r.status === 201 && placed.token, r.data);
r = await owner("GET", "/api/orders?status=all");
const mine = (await owner("GET", `/api/orders/${r.data.items.find((o) => o.number === placed.number).id}`)).data;
const anaHistory = (await owner("GET", `/api/customers/${anaCustomer.id}`)).data.history;
check("con el correo de la cuenta (no el que se envió) y ligado a su cliente", mine?.customerEmail === `ana-${stamp}@example.com`.toLowerCase() && anaHistory.some((h) => h.kind === "order" && h.number === placed.number), { email: mine?.customerEmail, anaHistory });
r = await shopper("GET", `/api/store/${slug}/account/orders`);
check("«Mis pedidos» lo muestra con su enlace", r.status === 200 && r.data.items.length === 1 && r.data.items[0].token === placed.token && r.data.items[0].items === 1 && r.data.items[0].totalCents === 8000, r.data);
r = await shopper("GET", `/api/store/${slug}/account`);
check("la cuenta recuerda el teléfono del pedido", r.data.account.phone === "5500001111", r.data.account);
r = await shopper("POST", `/api/store/${slug}/orders`, order({ clientId: `acc-${stamp}-delivery`, fulfillment: "delivery", address: "Av. Siempre Viva 742" }));
check("envío: también recuerda la dirección", r.status === 201 && (await shopper("GET", `/api/store/${slug}/account`)).data.account.address === "Av. Siempre Viva 742", r.data);

/* ---------------- Isolation ---------------- */
console.log("Aislamiento");
r = await shopper("GET", `/api/store/${otherSlug}/account`);
check("la sesión de una tienda no sirve en otra", r.data.account === null, r.data);
const forged = client();
forged.jar.set(`nx_customer|/api/store/${otherSlug}`, { name: "nx_customer", value: cookie.value, path: `/api/store/${otherSlug}` });
r = await forged("GET", `/api/store/${otherSlug}/account`);
check("ni copiando la cookie a la otra tienda", r.data.account === null, r.data);
r = await forged("POST", `/api/store/${otherSlug}/orders`, order({ items: [{ variantId, quantity: 1 }] }));
check("(ni para pedir ahí)", r.status === 401, r.data);

/* ---------------- Profile and password ---------------- */
console.log("Mis datos y contraseña");
r = await shopper("PUT", `/api/store/${slug}/account`, { name: "Ana C. Compradora", phone: "5511223344", address: "Calle Nueva 10", acceptsMarketing: false });
check("actualizar mis datos", r.status === 200 && r.data.account.name === "Ana C. Compradora" && r.data.account.address === "Calle Nueva 10" && r.data.account.acceptsMarketing === false, r.data);
r = await owner("GET", `/api/customers/${anaCustomer.id}`);
check("en Clientes: llena lo vacío y respeta la elección de promociones", r.data.address === "Calle Nueva 10" && r.data.acceptsMarketing === false, r.data);
const second = client();
await second("POST", `/api/store/${slug}/account/login`, { email: `ana-${stamp}@example.com`, password: pwd });
r = await second("GET", `/api/store/${slug}/account`);
check("iniciar sesión en otro dispositivo", r.data.account?.email === `ana-${stamp}@example.com`.toLowerCase(), r.data);
r = await shopper("POST", `/api/store/${slug}/account/password`, { currentPassword: "mala", newPassword: "nueva-contrasena-77" });
check("cambiar contraseña pide la actual", r.status === 422 && r.data.error.fields.currentPassword, r.data);
r = await shopper("POST", `/api/store/${slug}/account/password`, { currentPassword: pwd, newPassword: "nueva-contrasena-77" });
check("cambiar contraseña", r.status === 204 && (await shopper("GET", `/api/store/${slug}/account`)).data.account !== null, r.data);
r = await second("GET", `/api/store/${slug}/account`);
check("cierra la sesión en los otros dispositivos", r.data.account === null, r.data);
r = await shopper("POST", `/api/store/${slug}/account/logout`);
check("cerrar sesión", r.status === 204 && (await shopper("GET", `/api/store/${slug}/account`)).data.account === null, r.data);
r = await shopper("GET", `/api/store/${slug}/account/orders`);
check("«Mis pedidos» sin sesión → 401", r.status === 401, r.data);

/* ---------------- Sign-in, lockout and reset ---------------- */
console.log("Entrar y recuperar");
const thief = client("10.2.0.9");
for (let i = 0; i < 5; i++) await thief("POST", `/api/store/${slug}/account/login`, { email: `ana-${stamp}@example.com`, password: "intento-malo-1" });
r = await thief("POST", `/api/store/${slug}/account/login`, { email: `ana-${stamp}@example.com`, password: "nueva-contrasena-77" });
check("5 intentos fallidos bloquean 15 minutos", r.status === 429, r.data);
r = await other("POST", "/api/auth/login", { email: `victor-${stamp}@example.com`, password: pwd });
check("(el bloqueo es solo de esa tienda: el panel no se entera)", r.status === 200, r.data);
r = await client()("POST", `/api/store/${slug}/account/forgot`, { email: `nadie-${stamp}@example.com` });
check("recuperar con un correo sin cuenta → 204 (no revela nada)", r.status === 204, r.data);
r = await client()("POST", `/api/store/${slug}/account/forgot`, { email: `ana-${stamp}@example.com` });
check("recuperar: enlace de la tienda (/cuenta/restablecer)", r.status === 200 && r.data.devResetUrl.includes(`/${slug}/cuenta/restablecer?token=`), r.data);
const token = new URL(r.data.devResetUrl).searchParams.get("token");
const fresh = client();
r = await fresh("POST", `/api/store/${slug}/account/reset`, { token, password: "otra-contrasena-88" });
check("restablecer: inicia sesión", r.status === 200 && r.data.account.email === `ana-${stamp}@example.com`.toLowerCase() && (await fresh("GET", `/api/store/${slug}/account`)).data.account, r.data);
r = await client()("POST", `/api/store/${slug}/account/reset`, { token, password: "otra-contrasena-99" });
check("el enlace sirve una sola vez", r.status === 400, r.data);
r = await thief("POST", `/api/store/${slug}/account/login`, { email: `ana-${stamp}@example.com`, password: "otra-contrasena-88" });
check("y quita el bloqueo", r.status === 200, r.data);
r = await client()("POST", `/api/store/${otherSlug}/account/reset`, { token, password: "otra-contrasena-99" });
check("un enlace de una tienda no sirve en otra", r.status === 400, r.data);

/* ---------------- Guest orders when the store allows them ---------------- */
console.log("Compras sin cuenta (si la tienda lo permite)");
settings = (await owner("GET", "/api/store-settings")).data;
r = await owner("PUT", "/api/store-settings", { ...settings, accountRequired: false });
check("desactivar «Pedir cuenta para comprar»", r.status === 200 && r.data.accountRequired === false, r.data);
const before = (await fresh("GET", `/api/store/${slug}/account/orders`)).data.items.length;
const guest = client(`10.3.0.${Math.floor(Math.random() * 200) + 1}`);
r = await guest("POST", `/api/store/${slug}/orders`, order({ clientId: `acc-${stamp}-guest`, customerEmail: `ana-${stamp}@example.com` }));
check("el invitado compra sin cuenta", r.status === 201, r.data);
const guestToken = r.data.token;
r = await fresh("GET", `/api/store/${slug}/account/orders`);
check("un pedido sin cuenta con su correo NO aparece en «Mis pedidos»", r.data.items.length === before && !r.data.items.some((o) => o.token === guestToken), r.data.items.length);
r = await owner("PUT", "/api/store-settings", { ...settings, accountRequired: true });

/* ---------------- Sign-up limit ---------------- */
console.log("Límite de registros");
const bot = client("10.9.9.9");
let last;
for (let i = 0; i < 6; i++) last = await bot("POST", `/api/store/${slug}/account/register`, { name: `Bot ${i}`, email: `bot${i}-${stamp}@example.com`, password: pwd });
check("más de 5 cuentas por hora desde la misma conexión → 429", last.status === 429 && last.data.error.code === "too_many_signups", last.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
