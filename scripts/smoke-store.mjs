// End-to-end test of Phase 4 (online store + online orders) against a running API.
// Usage: node scripts/smoke-store.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;
let seq = 0;
const cid = () => `w-${stamp}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

function client() {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const h = { ...headers, ...(cookie ? { cookie } : {}) };
    let payload;
    if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
}
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}

const owner = client();
await owner("POST", "/api/auth/register", { businessName: `Tienda ${stamp}`, ownerName: "Olga Dueña", email: `olga-${stamp}@example.com`, password: "contrasena-segura-1" });
await owner("POST", "/api/dev/plan", { plan: "business" }); // the free plan allows 1 location, 2 users and 100 products
const slug = (await owner("GET", "/api/me")).data.tenant.slug;
const settings = (await owner("GET", "/api/settings")).data;
await owner("PUT", "/api/settings", { ...settings, updatedAt: undefined, pricesIncludeTax: true, email: `avisos-${stamp}@example.com` });
const main = (await owner("GET", "/api/locations")).data[0].id;
await owner("POST", "/api/taxes", { name: "IVA 16%", rateBps: 1600, isDefault: true, active: true });
const cat = (await owner("POST", "/api/categories", { name: "Cerámica" })).data.id;

const taza = (await owner("POST", "/api/products", { name: "Taza artesanal", categoryId: cat, online: true, description: "Hecha a mano.", variants: [{ sku: `TA-${stamp}`, priceCents: 11600, costCents: 5000, initialStock: 3 }] })).data;
const playera = (await owner("POST", "/api/products", {
  name: "Playera", optionNames: ["Talla"],
  variants: [{ options: ["M"], priceCents: 25000, costCents: 9000, initialStock: 10 }, { options: ["G"], priceCents: 27000, costCents: 9500, initialStock: 0 }],
})).data;
const envoltura = (await owner("POST", "/api/products", { name: "Envoltura de regalo", unit: "service", trackInventory: false, online: true, variants: [{ priceCents: 3000 }] })).data;
const oculto = (await owner("POST", "/api/products", { name: "Producto interno", variants: [{ priceCents: 1000, initialStock: 5 }] })).data;
const tv = taza.variants[0].id, pm = playera.variants.find((v) => v.options[0] === "M").id, pg = playera.variants.find((v) => v.options[0] === "G").id, ev = envoltura.variants[0].id;
const stockOf = async (productId, variantId) => (await owner("GET", `/api/products/${productId}`)).data.variants.find((v) => v.id === variantId).stock;
const shopper = client();

console.log("Configuración de la tienda");
let r = await shopper("GET", `/api/store/${slug}`);
check("tienda desactivada → 404", r.status === 404, r.data);
r = await owner("GET", "/api/store-settings");
check("ajustes por defecto con dirección pública", r.status === 200 && r.data.enabled === false && r.data.url.endsWith(`/${slug}`) && r.data.publishedCount === 2 && r.data.activeCount === 4, r.data);
const base = { ...r.data };
delete base.slug; delete base.url; delete base.publishedCount; delete base.activeCount;
r = await owner("PUT", "/api/store-settings", { ...base, enabled: true, locationId: null });
check("activar sin ubicación → 422", r.status === 422 && r.data.error.fields?.locationId, r.data);
r = await owner("PUT", "/api/store-settings", { ...base, enabled: true, locationId: main, transferEnabled: true, transferInstructions: null });
check("transferencia sin datos bancarios → 422", r.status === 422 && r.data.error.fields?.transferInstructions, r.data);
const storeConfig = {
  ...base, enabled: true, locationId: main, tagline: "Hecho a mano en Oaxaca", pickupEnabled: true, pickupInstructions: "Lunes a sábado de 10 a 19 h.",
  deliveryEnabled: true, deliveryFeeCents: 5000, freeDeliveryFromCents: 50000, deliveryArea: "Centro de la ciudad", minOrderCents: 10000,
  payOnDelivery: true, transferEnabled: true, transferInstructions: "CLABE 012345678901234567", whatsapp: "+52 (55) 1234-5678", holdHours: 48,
};
r = await owner("PUT", "/api/store-settings", storeConfig);
check("activar tienda", r.status === 200 && r.data.enabled && r.data.whatsapp === "+525512345678", r.data);
r = await owner("POST", "/api/store-settings/publish", { productIds: [playera.id], online: true });
check("publicar productos en bloque", r.status === 200 && r.data.publishedCount === 3, r.data);

console.log("Catálogo público");
r = await shopper("GET", `/api/store/${slug}`);
check("datos públicos de la tienda", r.status === 200 && r.data.name === `Tienda ${stamp}` && r.data.deliveryFeeCents === 5000 && r.data.categories.length === 1 && r.data.categories[0].count === 1, r.data);
r = await shopper("GET", `/api/store/${slug}/products`);
const cards = r.data.items;
check("solo productos publicados", r.data.total === 3 && !cards.some((p) => p.id === oculto.id), cards.map((p) => p.name));
const cTaza = cards.find((p) => p.id === taza.id), cPlay = cards.find((p) => p.id === playera.id), cEnv = cards.find((p) => p.id === envoltura.id);
check("precio desde y precio variable", cPlay.fromPriceCents === 25000 && cPlay.priceVaries && !cTaza.priceVaries, cPlay);
check("últimas piezas (3) y sin inventario siempre disponible", cTaza.lowStock && !cTaza.soldOut && !cEnv.soldOut && !cEnv.lowStock, [cTaza, cEnv]);
r = await shopper("GET", `/api/store/${slug}/products?q=taza`);
check("búsqueda", r.data.items.length === 1 && r.data.items[0].id === taza.id, r.data.items);
r = await shopper("GET", `/api/store/${slug}/products?categoryId=${cat}`);
check("filtro por categoría", r.data.items.length === 1, r.data.items);
r = await shopper("GET", `/api/store/${slug}/products?sort=price_desc`);
check("orden por precio", r.data.items[0].id === playera.id && r.data.items[2].id === envoltura.id, r.data.items.map((p) => p.name));
r = await shopper("GET", `/api/store/${slug}/products/${playera.id}`);
check("detalle con variantes y disponibilidad", r.status === 200 && r.data.variants.length === 2 && r.data.variants.find((v) => v.id === pg).available === 0 && r.data.optionNames[0] === "Talla", r.data);
r = await shopper("GET", `/api/store/${slug}/products/${oculto.id}`);
check("producto no publicado → 404", r.status === 404, r.data);
r = await shopper("GET", `/api/store/no-existe-${stamp.toLowerCase()}/products`);
check("tienda inexistente → 404", r.status === 404, r.data);

console.log("Pedidos");
const order = (items, extra = {}) => ({
  clientId: cid(), items, fulfillment: "pickup", customerName: "Lucía Cliente", customerEmail: `lucia-${stamp}@example.com`, customerPhone: "55 1234 5678",
  address: null, notes: null, paymentMethod: "on_delivery", expectedTotalCents: 0, ...extra,
});
r = await shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: tv, quantity: 1 }]));
check("total cambiado → 409 con el total correcto", r.status === 409 && r.data.error.code === "price_changed" && r.data.error.fields.expectedTotalCents === "11600", r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: ev, quantity: 1 }], { expectedTotalCents: 3000 }));
check("pedido mínimo ($100) → 422", r.status === 422 && r.data.error.code === "min_order", r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: tv, quantity: 1 }], { fulfillment: "delivery", expectedTotalCents: 16600 }));
check("envío sin dirección → 422", r.status === 422 && r.data.error.fields?.address, r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: (oculto.variants[0].id), quantity: 1 }], { expectedTotalCents: 1000 }));
check("producto no publicado no se compra", r.status === 409 && r.data.error.code === "unavailable", r.data);

// 1 taza (116) + 1 playera M (250) + envoltura (30) = 396 + envío 50 = 446
const first = order([{ variantId: tv, quantity: 1 }, { variantId: pm, quantity: 1 }, { variantId: ev, quantity: 1 }], {
  fulfillment: "delivery", address: "Calle Reforma 123, Col. Centro, CP 68000", paymentMethod: "transfer", notes: "Tocar el timbre", expectedTotalCents: 44600,
});
r = await shopper("POST", `/api/store/${slug}/orders`, first);
check("pedido con envío y transferencia", r.status === 201 && r.data.number === 1 && r.data.token.length >= 20, r.data);
const t1 = r.data.token;
r = await shopper("POST", `/api/store/${slug}/orders`, first);
check("reintento con el mismo clientId devuelve el mismo pedido", r.status === 200 && r.data.token === t1, r.data);
check("aparta existencias: taza 3 → 2, playera 10 → 9", await stockOf(taza.id, tv) === 2 && await stockOf(playera.id, pm) === 9);
r = await owner("GET", `/api/inventory/movements?variantId=${tv}&type=order`);
check("Kardex: salida tipo pedido en línea", r.data.items.length === 1 && r.data.items[0].quantity === -1 && r.data.items[0].reason === "online_order", r.data.items);
r = await shopper("GET", `/api/store/${slug}/orders/${t1}`);
check("seguimiento público con datos para transferir", r.status === 200 && r.data.status === "pending" && r.data.totalCents === 44600 && r.data.shippingCents === 5000 && r.data.transferInstructions.includes("CLABE") && r.data.canCancel, r.data);
r = await shopper("GET", `/api/store/${slug}/orders/token-falso-${stamp}`);
check("token inventado → 404", r.status === 404, r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: pm, quantity: 2 }], { fulfillment: "delivery", address: "Av. Juárez 45, Centro, CP 68000", expectedTotalCents: 50000 }));
check("envío gratis desde $500", r.status === 201, r.data);
const t2 = r.data.token;

// Two customers want the last 2 mugs at the same time: only one gets them.
const race = await Promise.all([
  shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: tv, quantity: 2 }], { expectedTotalCents: 23200 })),
  shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: tv, quantity: 2 }], { expectedTotalCents: 23200 })),
]);
check("dos clientes por las últimas piezas: solo uno", race.filter((x) => x.status === 201).length === 1 && race.some((x) => x.status === 409 && x.data.error.message.includes("Taza artesanal")), race.map((x) => [x.status, x.data?.error?.message]));
const t3 = race.find((x) => x.status === 201).data.token;
check("taza agotada en la tienda", (await shopper("GET", `/api/store/${slug}/products`)).data.items.find((p) => p.id === taza.id).soldOut === true);

r = await shopper("POST", `/api/store/${slug}/orders/${t3}/cancel`);
check("el cliente cancela su pedido nuevo", r.status === 200 && r.data.status === "cancelled" && !r.data.canCancel, r.data);
check("el stock regresa (0 → 2)", await stockOf(taza.id, tv) === 2);
r = await shopper("POST", `/api/store/${slug}/orders/${t3}/cancel`);
check("cancelar dos veces → 409", r.status === 409, r.data);

// The POS sells the last mugs: the web can no longer take them.
await owner("POST", "/api/cash/open", { locationId: main, openingCashCents: 0 });
await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 2 }], payments: [{ method: "cash", amountCents: 23200 }] });
r = await shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: tv, quantity: 1 }], { expectedTotalCents: 11600 }));
check("lo vendido en caja ya no se vende en línea", r.status === 409 && r.data.error.message.includes("se agotó"), r.data);

console.log("Atención en el panel");
r = await owner("GET", "/api/orders/counts");
check("contador de pedidos nuevos", r.data.pending === 2 && r.data.open === 2, r.data);
r = await owner("GET", "/api/orders");
check("lista de pedidos abiertos", r.data.total === 2 && r.data.items[0].status === "pending", r.data.items);
const o1 = r.data.items.find((o) => o.number === 1).id;
const o2 = r.data.items.find((o) => o.number === 2).id;
r = await owner("GET", `/api/orders/${o1}`);
check("detalle con enlace de seguimiento y costo", r.data.trackingUrl.endsWith(`/${slug}/pedido/${t1}`) && r.data.costCents === 5000 + 9000 && r.data.customerPhone === "55 1234 5678", r.data);
r = await owner("POST", `/api/orders/${o1}/confirm`);
check("aceptar pedido", r.status === 200 && r.data.status === "confirmed", r.data);
r = await owner("POST", `/api/orders/${o1}/confirm`);
check("aceptar dos veces → 409", r.status === 409, r.data);
r = await shopper("POST", `/api/store/${slug}/orders/${t1}/cancel`);
check("el cliente ya no cancela uno aceptado", r.status === 409, r.data);
r = await owner("POST", `/api/orders/${o1}/pay`, { method: "transfer", reference: "SPEI 99812" });
check("registrar transferencia recibida", r.status === 200 && r.data.paymentStatus === "paid" && r.data.paidReference === "SPEI 99812", r.data);
r = await owner("POST", `/api/orders/${o1}/pay`, { method: "transfer", reference: null });
check("cobrar dos veces → 409", r.status === 409, r.data);
r = await owner("POST", `/api/orders/${o1}/ready`);
check("marcar en camino", r.status === 200 && r.data.status === "ready", r.data);
r = await shopper("GET", `/api/store/${slug}/orders/${t1}`);
check("el cliente ve su pedido en camino y pagado", r.data.status === "ready" && r.data.paymentStatus === "paid", r.data);
r = await owner("POST", `/api/orders/${o1}/complete`, { payment: null });
check("entregar pedido pagado", r.status === 200 && r.data.status === "completed" && r.data.completedByName === "Olga Dueña", r.data);

r = await owner("POST", `/api/orders/${o2}/complete`, { payment: null });
check("entregar sin registrar el pago → 422", r.status === 422 && r.data.error.code === "payment_required", r.data);
const session = (await owner("GET", `/api/cash/current?locationId=${main}`)).data;
await owner("POST", `/api/cash/${session.id}/close`, { countedCashCents: 23200, note: null });
r = await owner("POST", `/api/orders/${o2}/complete`, { payment: { method: "cash", reference: null } });
check("cobro en efectivo con la caja cerrada → 409", r.status === 409 && r.data.error.code === "cash_closed", r.data);
r = await owner("POST", "/api/cash/open", { locationId: main, openingCashCents: 10000 });
const s2 = r.data.id;
r = await owner("POST", `/api/orders/${o2}/complete`, { payment: { method: "cash", reference: null } });
check("entregar cobrando en efectivo", r.status === 200 && r.data.status === "completed" && r.data.paidMethod === "cash", r.data);
r = await owner("GET", `/api/cash/current?locationId=${main}`);
check("el efectivo entra a la caja (100 + 500)", r.data.expectedCashCents === 60000 && r.data.movements.some((m) => m.reason.includes("Pedido en línea #000002")), r.data);
r = await owner("GET", "/api/reports/dashboard");
check("dashboard: ventas de hoy incluyen las de la tienda", r.data.sales.onlineCount === 2 && r.data.sales.onlineTotalCents === 44600 + 50000 && r.data.sales.totalCents === 23200 + 44600 + 50000 && r.data.orders.open === 0, r.data.sales);
check("lo más vendido incluye lo vendido en línea", r.data.topProducts.some((p) => p.productId === playera.id && p.quantity === 3), r.data.topProducts);

console.log("Cancelaciones y permisos");
r = await shopper("POST", `/api/store/${slug}/orders`, order([{ variantId: pm, quantity: 1 }], { expectedTotalCents: 25000 }));
const t4 = r.data.token;
const o4 = (await owner("GET", "/api/orders")).data.items[0].id;
await owner("POST", "/api/users", { name: "Ciro Caja", email: `ciro-${stamp}@example.com`, role: "cashier", password: "otra-contrasena-1" });
const cashier = client();
await cashier("POST", "/api/auth/login", { email: `ciro-${stamp}@example.com`, password: "otra-contrasena-1" });
r = await cashier("POST", `/api/orders/${o4}/confirm`);
check("el cajero acepta pedidos", r.status === 200 && r.data.costCents === null, r.data);
r = await cashier("POST", `/api/orders/${o4}/cancel`, { reason: "Sin talla" });
check("el cajero no cancela pedidos → 403", r.status === 403, r.data);
r = await cashier("PUT", "/api/store-settings", storeConfig);
check("el cajero no cambia la tienda → 403", r.status === 403, r.data);
const before = await stockOf(playera.id, pm);
r = await owner("POST", `/api/orders/${o4}/cancel`, { reason: "Se manchó la prenda" });
check("cancelar pedido aceptado regresa existencias", r.status === 200 && r.data.status === "cancelled" && r.data.cancelledBy === "staff" && await stockOf(playera.id, pm) === before + 1, r.data);
r = await shopper("GET", `/api/store/${slug}/orders/${t4}`);
check("el cliente ve el motivo", r.data.status === "cancelled" && r.data.cancelReason === "Se manchó la prenda", r.data);
r = await owner("POST", `/api/orders/${o4}/complete`, { payment: { method: "card", reference: null } });
check("no se entrega un pedido cancelado → 409", r.status === 409, r.data);

const other = client();
await other("POST", "/api/auth/register", { businessName: `Otra ${stamp}`, ownerName: "Otro", email: `otra-${stamp}@example.com`, password: "contrasena-segura-1" });
r = await other("GET", `/api/orders/${o1}`);
check("otro negocio no ve el pedido → 404", r.status === 404, r.data);
const otherSlug = (await other("GET", "/api/me")).data.tenant.slug;
r = await shopper("GET", `/api/store/${otherSlug}/orders/${t1}`);
check("el token no funciona en otra tienda", r.status === 404, r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, { ...order([{ variantId: pm, quantity: 1 }], { expectedTotalCents: 25000 }) }, { origin: "https://otro-sitio.example.com" });
check("la API pública acepta pedidos desde el dominio de la tienda (sin cookies)", r.status === 201, r.data);
await owner("PUT", "/api/store-settings", { ...storeConfig, enabled: false });
r = await shopper("GET", `/api/store/${slug}/products`);
check("desactivar la tienda la oculta", r.status === 404, r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
