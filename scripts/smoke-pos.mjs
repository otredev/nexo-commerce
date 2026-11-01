// End-to-end test of Phase 2 (point of sale + cash) against a running API.
// Usage: node scripts/smoke-pos.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;
let seq = 0;
const cid = () => `t-${stamp}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const headers = cookie ? { cookie } : {};
    let payload;
    if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload });
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
await owner("POST", "/api/auth/register", { businessName: `POS ${stamp}`, ownerName: "Sofía Dueña", email: `sofia-${stamp}@example.com`, password: "contrasena-segura-1" });
await owner("POST", "/api/dev/plan", { plan: "business" }); // the free plan allows 1 location, 2 users and 100 products
const settings = (await owner("GET", "/api/settings")).data;
await owner("PUT", "/api/settings", { ...settings, updatedAt: undefined, pricesIncludeTax: true, cashierMaxDiscountBps: 1000 });
const main = (await owner("GET", "/api/locations")).data[0].id;
await owner("POST", "/api/taxes", { name: "IVA 16%", rateBps: 1600, isDefault: true, active: true });
const exento = (await owner("POST", "/api/taxes", { name: "Exento", rateBps: 0, isDefault: false, active: true })).data.id;

const taza = (await owner("POST", "/api/products", { name: "Taza", variants: [{ sku: `TZ-${stamp}`, barcode: `77${stamp}`, priceCents: 11600, costCents: 5000, initialStock: 10, minStock: 2 }] })).data;
const pan = (await owner("POST", "/api/products", { name: "Pan de caja", taxRateId: exento, variants: [{ priceCents: 4500, costCents: 2000, initialStock: 5 }] })).data;
const queso = (await owner("POST", "/api/products", { name: "Queso", unit: "kg", variants: [{ priceCents: 25000, costCents: 15000, initialStock: 3 }] })).data;
const envoltura = (await owner("POST", "/api/products", { name: "Envoltura", unit: "service", trackInventory: false, variants: [{ priceCents: 3000 }] })).data;
const tv = taza.variants[0].id, pv = pan.variants[0].id, qv = queso.variants[0].id, ev = envoltura.variants[0].id;

console.log("Caja");
let r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1 }], payments: [{ method: "cash", amountCents: 11600 }] });
check("no se vende con la caja cerrada → 409", r.status === 409 && r.data.error.code === "cash_closed", r.data);
r = await owner("GET", `/api/cash/current?locationId=${main}`);
check("sin caja abierta", r.status === 200 && r.data === null, r.data);
r = await owner("POST", "/api/cash/open", { locationId: main, openingCashCents: 50000 });
check("abrir caja con fondo de $500", r.status === 201 && r.data.status === "open", r.data);
const session = r.data.id;
r = await owner("POST", "/api/cash/open", { locationId: main, openingCashCents: 0 });
check("solo una caja abierta por ubicación → 409", r.status === 409, r.data);

console.log("Búsqueda del POS");
r = await owner("GET", `/api/pos/products?locationId=${main}&q=77${stamp}`);
check("escáner: código de barras exacto primero", r.data[0]?.variantId === tv && r.data[0].exact === true && r.data[0].stock === 10 && r.data[0].taxRateBps === 1600, r.data[0]);
r = await owner("GET", `/api/pos/products?locationId=${main}&q=tz-${stamp}`);
check("SKU sin importar mayúsculas", r.data[0]?.variantId === tv && r.data[0].exact, r.data[0]);
r = await owner("GET", `/api/pos/products?locationId=${main}`);
check("catálogo completo con impuestos efectivos", r.data.length === 4 && r.data.find((p) => p.variantId === pv).taxRateBps === 0 && r.data.find((p) => p.variantId === ev).stock === null, r.data.map((p) => [p.name, p.taxRateBps, p.stock]));

console.log("Ventas");
const sale1Id = cid();
r = await owner("POST", "/api/sales", {
  clientId: sale1Id, locationId: main,
  items: [{ variantId: tv, quantity: 2 }, { variantId: pv, quantity: 1 }, { variantId: qv, quantity: 0.75 }, { variantId: ev, quantity: 1 }],
  payments: [{ method: "cash", amountCents: 50000 }],
  customerName: "Juan Pérez",
});
const s1 = r.data;
// 2×116 + 45 + 0.75×250 + 30 = 232 + 45 + 187.5 + 30 = 494.50
check("venta con varios productos, kg y servicio", r.status === 201 && s1.totalCents === 49450 && s1.number === 1, s1);
check("impuestos calculados por línea (incluidos)", s1.taxCents === 3200 + 0 + 2586 + 414, { tax: s1.taxCents });
check("cambio", s1.changeCents === 550 && s1.paidCents === 50000, s1);
check("instantánea de precio y nombre en la venta", s1.items[0].name === "Taza" && s1.items[0].unitPriceCents === 11600, s1.items[0]);
r = await owner("POST", "/api/sales", { clientId: sale1Id, locationId: main, items: [{ variantId: tv, quantity: 2 }], payments: [{ method: "cash", amountCents: 50000 }] });
check("reintento con el mismo clientId devuelve la misma venta (idempotente)", r.status === 200 && r.data.id === s1.id, r.data);
r = await owner("GET", `/api/products/${taza.id}`);
check("descuenta existencias", r.data.variants[0].stock === 8, r.data.variants[0]);
r = await owner("GET", `/api/inventory/movements?variantId=${tv}`);
check("Kardex registra la venta", r.data.items[0].type === "sale" && r.data.items[0].quantity === -2 && r.data.items[0].balanceAfter === 8, r.data.items[0]);

r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1 }], payments: [{ method: "card", amountCents: 11600, reference: "AUTH-1" }] });
check("pago con tarjeta exacto", r.status === 201 && r.data.number === 2, r.data);
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1 }], payments: [{ method: "card", amountCents: 20000 }] });
check("tarjeta mayor al total → 422", r.status === 422, r.data);
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1 }], payments: [{ method: "cash", amountCents: 5000 }] });
check("pago insuficiente → 422", r.status === 422, r.data);
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 2 }], payments: [{ method: "card", amountCents: 20000 }, { method: "cash", amountCents: 5000 }] });
check("pago mixto con cambio en efectivo", r.status === 201 && r.data.changeCents === 1800, r.data);
const mixedId = r.data.id;
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1 }], discountCents: 1160, payments: [{ method: "transfer", amountCents: 10440 }] });
check("descuento de carrito y transferencia", r.status === 201 && r.data.totalCents === 10440 && r.data.discountCents === 1160, r.data);
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: pv, quantity: 9 }], payments: [{ method: "cash", amountCents: 100000 }] });
check("sin existencia suficiente → 409 con el producto", r.status === 409 && r.data.error.message.includes("Pan de caja"), r.data);
r = await owner("GET", `/api/sales?q=${encodeURIComponent("#000006")}`);
check("la venta rechazada no consumió folio ni dejó rastros", r.data.total === 0, r.data);
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1.5 }], payments: [{ method: "cash", amountCents: 50000 }] });
check("piezas no aceptan decimales → 422", r.status === 422, r.data);

console.log("Descuentos por rol");
await owner("POST", "/api/users", { name: "Carlos Caja", email: `carlos-${stamp}@example.com`, role: "cashier", password: "otra-contrasena-1" });
const cashier = client();
await cashier("POST", "/api/auth/login", { email: `carlos-${stamp}@example.com`, password: "otra-contrasena-1" });
r = await cashier("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1, discountCents: 2320 }], payments: [{ method: "cash", amountCents: 20000 }] });
check("cajero no pasa de su límite (10 %) → 403", r.status === 403 && r.data.error.code === "discount_limit", r.data);
r = await cashier("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: tv, quantity: 1, discountCents: 1160 }], payments: [{ method: "cash", amountCents: 20000 }] });
check("cajero sí dentro del límite", r.status === 201 && r.data.userName === "Carlos Caja", r.data);
r = await cashier("GET", `/api/cash/current?locationId=${main}`);
check("cierre ciego: el cajero no ve el efectivo esperado", r.data.expectedCashCents === null, r.data);
r = await cashier("POST", `/api/sales/${s1.id}/void`, { reason: "Error" });
check("cajero no anula → 403", r.status === 403);

console.log("Concurrencia: dos cajas compiten por la última unidad");
const lastProduct = (await owner("POST", "/api/products", { name: "Última pieza", variants: [{ priceCents: 1000, initialStock: 1 }] })).data.variants[0].id;
const race = await Promise.all(Array.from({ length: 6 }, () => owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: lastProduct }].map((i) => ({ ...i, quantity: 1 })), payments: [{ method: "cash", amountCents: 1000 }] })));
check("solo una venta gana, las demás → 409", race.filter((x) => x.status === 201).length === 1 && race.filter((x) => x.status === 409).length === 5, race.map((x) => x.status));
const numbers = (await owner("GET", "/api/sales?pageSize=100")).data.items.map((s) => s.number).sort((a, b) => a - b);
check("folios consecutivos, sin huecos", numbers.every((n, i) => n === i + 1), numbers);

console.log("Anulación y devoluciones");
r = await owner("POST", `/api/sales/${mixedId}/void`, { reason: "Cobro duplicado" });
check("anular venta del turno abierto", r.status === 200 && r.data.status === "voided" && r.data.voidReason === "Cobro duplicado", r.data);
r = await owner("POST", `/api/sales/${mixedId}/void`, { reason: "otra vez" });
check("no se anula dos veces → 409", r.status === 409);
r = await owner("GET", `/api/inventory/movements?variantId=${tv}&type=return`);
check("anular regresa el stock al Kardex", r.data.items[0]?.reason === "void" && r.data.items[0].quantity === 2, r.data.items[0]);
const qItem = s1.items.find((i) => i.variantId === qv);
r = await owner("POST", `/api/sales/${s1.id}/returns`, { items: [{ saleItemId: qItem.id, quantity: 0.25 }], refundMethod: "cash", restock: true, reason: "No le gustó", locationId: main });
check("devolución parcial en kg con reembolso en efectivo", r.status === 201 && r.data.refundedCents === Math.round((qItem.totalCents * 250) / 750) && r.data.items.find((i) => i.id === qItem.id).returnedQuantity === 0.25, r.data);
r = await owner("POST", `/api/sales/${s1.id}/returns`, { items: [{ saleItemId: qItem.id, quantity: 0.5 }], refundMethod: "card", restock: false, reason: "Dañado", locationId: main });
check("devolver el resto suma exactamente el total de la línea", r.status === 201 && r.data.returns.reduce((a, x) => a + x.items.reduce((b, i) => b + i.refundCents, 0), 0) === qItem.totalCents, r.data.returns);
r = await owner("POST", `/api/sales/${s1.id}/returns`, { items: [{ saleItemId: qItem.id, quantity: 0.1 }], refundMethod: "cash", restock: true, reason: "x", locationId: main });
check("no se devuelve más de lo vendido → 422", r.status === 422, r.data);
r = await owner("GET", `/api/products/${queso.id}`);
check("solo lo reingresado vuelve al stock (sin el dañado)", r.data.variants[0].stock === 2.5, r.data.variants[0]);
r = await owner("POST", `/api/sales/${s1.id}/void`, { reason: "x" });
check("venta con devoluciones no se anula → 409", r.status === 409);

console.log("Movimientos de efectivo y corte");
r = await owner("POST", `/api/cash/${session}/movements`, { type: "in", amountCents: 20000, reason: "Cambio adicional" });
check("ingreso de efectivo", r.status === 201);
r = await owner("POST", `/api/cash/${session}/movements`, { type: "out", amountCents: 10000000, reason: "Retiro" });
check("no se retira más efectivo del que hay → 422", r.status === 422, r.data);
r = await owner("POST", `/api/cash/${session}/movements`, { type: "out", amountCents: 30000, reason: "Pago a proveedor" });
check("retiro de efectivo", r.status === 201);
r = await owner("GET", `/api/cash/current?locationId=${main}`);
const t = r.data.totals;
// Cash: opening 500 + sale1 (500-5.50) + cashier sale (200-?)... computed from parts:
const cashSales = t.byMethod.cash;
const refundQ = Math.round((qItem.totalCents * 250) / 750);
check("efectivo esperado = fondo + ventas en efectivo + ingresos − retiros − reembolsos", r.data.expectedCashCents === 50000 + cashSales + 20000 - 30000 - refundQ, { t, expected: r.data.expectedCashCents });
check("ventas por método excluyen la anulada", t.byMethod.card === 11600 && t.byMethod.transfer === 10440, t.byMethod);
const expected = r.data.expectedCashCents;
r = await owner("POST", `/api/cash/${session}/close`, { countedCashCents: expected - 500, note: "Faltaron $5" });
check("cierre con diferencia (faltante de $5)", r.status === 200 && r.data.status === "closed" && r.data.differenceCents === -500 && r.data.expectedCashCents === expected, r.data);
r = await owner("POST", `/api/cash/${session}/movements`, { type: "in", amountCents: 100, reason: "x" });
check("caja cerrada no acepta movimientos → 409", r.status === 409);
r = await owner("GET", `/api/sales/${s1.id}`);
check("tras el cierre la venta ya no es anulable", r.data.voidable === false);
r = await owner("POST", `/api/sales/${s1.id}/returns`, { items: [{ saleItemId: s1.items[0].id, quantity: 1 }], refundMethod: "cash", restock: true, reason: "x", locationId: main });
check("reembolso en efectivo exige caja abierta → 409", r.status === 409 && r.data.error.code === "cash_closed", r.data);
r = await owner("GET", "/api/cash/sessions");
check("historial de cortes", r.data.items[0]?.id === session && r.data.items[0].differenceCents === -500, r.data.items[0]);

console.log("Dashboard (tablas de resumen)");
r = await owner("GET", "/api/reports/dashboard");
const sales = (await owner("GET", "/api/sales?status=completed&pageSize=100")).data.items;
const gross = sales.reduce((a, s) => a + s.totalCents, 0);
const refunded = sales.reduce((a, s) => a + s.refundedCents, 0);
check("ventas de hoy = suma de ventas completadas − devoluciones", r.data.sales.totalCents === gross - refunded && r.data.sales.count === sales.length, { dash: r.data.sales, gross, refunded, n: sales.length });
check("7 días y productos más vendidos", r.data.days.length === 7 && r.data.topProducts[0]?.name === "Taza", r.data.topProducts);
check("utilidad bruta visible para el dueño", typeof r.data.sales.grossProfitCents === "number");
r = await cashier("GET", "/api/reports/dashboard");
check("el cajero no ve la utilidad", r.data.sales.grossProfitCents === null, r.data.sales);

console.log("Historial y recibo");
r = await owner("GET", "/api/sales?status=voided");
check("filtrar anuladas", r.data.total === 1 && r.data.items[0].id === mixedId, r.data);
r = await owner("GET", "/api/sales?q=juan");
check("buscar por cliente", r.data.total === 1 && r.data.items[0].customerName === "Juan Pérez", r.data);
r = await owner("POST", `/api/sales/${s1.id}/email`, { email: "cliente@example.com" });
check("enviar recibo por correo", r.status === 204, r.data);

console.log("Aislamiento");
const other = client();
await other("POST", "/api/auth/register", { businessName: `Otro POS ${stamp}`, ownerName: "Beto", email: `beto2-${stamp}@example.com`, password: "contrasena-segura-1" });
r = await other("GET", `/api/sales/${s1.id}`);
check("otro negocio no ve la venta → 404", r.status === 404);
const otherLoc = (await other("GET", "/api/locations")).data[0].id;
await other("POST", "/api/cash/open", { locationId: otherLoc, openingCashCents: 0 });
r = await other("POST", "/api/sales", { clientId: cid(), locationId: otherLoc, items: [{ variantId: tv, quantity: 1 }], payments: [{ method: "cash", amountCents: 20000 }] });
check("no puede vender productos ajenos → 409", r.status === 409, r.data);
r = await other("POST", "/api/sales", { clientId: sale1Id, locationId: otherLoc, items: [{ variantId: tv, quantity: 1 }], payments: [{ method: "cash", amountCents: 20000 }] });
check("el clientId de otro negocio no le devuelve la venta ajena", r.status !== 200 || r.data.id !== s1.id, r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
