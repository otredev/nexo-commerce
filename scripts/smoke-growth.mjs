// End-to-end test of Phase 5 (customers, promotions, coupons, accounts payable, reports).
// Usage: node scripts/smoke-growth.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;
let seq = 0;
const cid = () => `g-${stamp}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

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
    return { status: res.status, data, headers: res.headers };
  };
}
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}
const shift = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

const owner = client();
await owner("POST", "/api/auth/register", { businessName: `Crece ${stamp}`, ownerName: "Rosa Dueña", email: `rosa-${stamp}@example.com`, password: "contrasena-segura-1" });
const slug = (await owner("GET", "/api/me")).data.tenant.slug;
const main = (await owner("GET", "/api/locations")).data[0].id;
await owner("POST", "/api/taxes", { name: "IVA 16%", rateBps: 1600, isDefault: true, active: true });
const today = (await owner("GET", "/api/reports/dashboard")).data.today;
const ropa = (await owner("POST", "/api/categories", { name: "Ropa" })).data.id;
const hogar = (await owner("POST", "/api/categories", { name: "Hogar" })).data.id;
const playera = (await owner("POST", "/api/products", { name: "Playera lisa", categoryId: ropa, online: true, variants: [{ priceCents: 20000, costCents: 8000, initialStock: 50 }] })).data;
const cojin = (await owner("POST", "/api/products", { name: "Cojín", categoryId: hogar, online: true, variants: [{ priceCents: 30000, costCents: 12000, initialStock: 50 }] })).data;
const pv = playera.variants[0].id, cv = cojin.variants[0].id;
await owner("POST", "/api/cash/open", { locationId: main, openingCashCents: 100000 });
const s0 = (await owner("GET", "/api/store-settings")).data;
delete s0.slug; delete s0.url; delete s0.publishedCount; delete s0.activeCount;
await owner("PUT", "/api/store-settings", { ...s0, enabled: true, locationId: main });
const sale = (items, extra = {}) => owner("POST", "/api/sales", { clientId: cid(), locationId: main, items, payments: [{ method: "cash", amountCents: 1_000_000 }], ...extra });

console.log("Clientes");
let r = await owner("POST", "/api/customers", { name: "Andrés Gómez", email: "Andres@Example.com", phone: "55 1234-5678", taxId: "GOAA800101XX1", acceptsMarketing: true });
check("crear cliente (correo en minúsculas, teléfono solo dígitos)", r.status === 201 && r.data.email === "andres@example.com" && r.data.phone === "5512345678", r.data);
const andres = r.data.id;
r = await owner("POST", "/api/customers", { name: "Otro Andrés", email: "andres@example.com" });
check("correo repetido → 409 con el cliente existente", r.status === 409 && r.data.error.fields.existingId === andres, r.data);
r = await owner("POST", "/api/customers", { name: "Otro", phone: "(55) 1234 5678" });
check("teléfono repetido aunque se escriba distinto → 409", r.status === 409 && r.data.error.fields.phone, r.data);
r = await owner("GET", "/api/customers?q=andres");
check("búsqueda sin acentos", r.data.items.length === 1 && r.data.items[0].id === andres, r.data.items);
r = await owner("GET", "/api/customers?q=1234-56");
check("búsqueda por teléfono", r.data.items.length === 1, r.data.items);

console.log("Promociones");
r = await owner("POST", "/api/promotions", { name: "Buen Fin ropa", percentBps: 2000, target: "category", targetIds: [], channel: "all" });
check("promoción por categoría sin categorías → 422", r.status === 422 && r.data.error.fields.targetIds, r.data);
r = await owner("POST", "/api/promotions", { name: "Buen Fin ropa", percentBps: 2000, target: "category", targetIds: [ropa], channel: "all", startsOn: today, endsOn: shift(today, 3) });
check("crear promoción 20 % en Ropa", r.status === 201 && r.data.targetNames[0] === "Ropa", r.data);
const promoRopa = r.data.id;
await owner("POST", "/api/promotions", { name: "Solo en línea", percentBps: 1500, target: "product", targetIds: [cojin.id], channel: "online" });
await owner("POST", "/api/promotions", { name: "Futura", percentBps: 5000, target: "all", channel: "all", startsOn: shift(today, 10) });
r = await owner("GET", "/api/promotions/live");
check("promociones vigentes en caja: solo la de Ropa", r.data.length === 1 && r.data[0].id === promoRopa, r.data.map((p) => p.name));
r = await sale([{ variantId: pv, quantity: 2 }, { variantId: cv, quantity: 1 }], { customerId: andres });
// 2 × 200 − 20 % = 320; cojín 300 (the online-only promo does not apply at the register)
check("venta en caja con promoción aplicada por el servidor", r.status === 201 && r.data.totalCents === 62000 && r.data.promoDiscountCents === 8000 && r.data.discountCents === 8000, r.data);
check("venta ligada al cliente con su nombre en el recibo", r.data.customerId === andres && r.data.customerName === "Andrés Gómez" && r.data.customerContact === "andres@example.com", r.data);

console.log("Límite del cajero y cupones");
await owner("POST", "/api/users", { name: "Caro Caja", email: `caro-${stamp}@example.com`, role: "cashier", password: "otra-contrasena-1" });
const cashier = client();
await cashier("POST", "/api/auth/login", { email: `caro-${stamp}@example.com`, password: "otra-contrasena-1" });
r = await cashier("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: pv, quantity: 1 }], payments: [{ method: "cash", amountCents: 50000 }] });
check("la promoción del 20 % no cuenta contra el límite del cajero (10 %)", r.status === 201 && r.data.totalCents === 16000, r.data);
r = await cashier("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: cv, quantity: 1, discountCents: 4000 }], payments: [{ method: "cash", amountCents: 50000 }] });
check("pero un descuento a mano mayor al 10 % sí → 403", r.status === 403 && r.data.error.code === "discount_limit", r.data);
r = await owner("POST", "/api/promotions/coupons", { code: "bienvenida 10", kind: "percent", value: 1000, minSubtotalCents: 30000, maxUses: 2, channel: "all" });
check("código con espacio → 422", r.status === 422 && r.data.error.fields.code, r.data);
r = await owner("POST", "/api/promotions/coupons", { code: "bienvenida", kind: "percent", value: 1000, minSubtotalCents: 30000, maxUses: 2, channel: "all" });
check("crear cupón (código en mayúsculas)", r.status === 201 && r.data.code === "BIENVENIDA", r.data);
const couponId = r.data.id;
r = await owner("POST", "/api/promotions/coupons", { code: "BIENVENIDA", kind: "amount", value: 100, channel: "all" });
check("código repetido → 409", r.status === 409, r.data);
r = await cashier("GET", "/api/promotions/coupons/check/bienvenida");
check("el cajero valida un cupón", r.status === 200 && r.data.kind === "percent", r.data);
r = await cashier("GET", "/api/promotions/coupons/check/NOEXISTE");
check("cupón inexistente → 422", r.status === 422, r.data);
r = await cashier("POST", "/api/sales", { clientId: cid(), locationId: main, couponCode: "bienvenida", items: [{ variantId: pv, quantity: 1 }], payments: [{ method: "cash", amountCents: 50000 }] });
check("cupón bajo la compra mínima → 422 con el motivo", r.status === 422 && r.data.error.message.includes("compra mínima"), r.data);
r = await cashier("POST", "/api/sales", { clientId: cid(), locationId: main, couponCode: "bienvenida", items: [{ variantId: cv, quantity: 2 }], payments: [{ method: "cash", amountCents: 100000 }] });
// 600 − 10 % = 540
check("venta con cupón", r.status === 201 && r.data.totalCents === 54000 && r.data.couponCode === "BIENVENIDA" && r.data.promoDiscountCents === 6000, r.data);
// One use left: two registers try it at the same time.
const race = await Promise.all([1, 2].map(() => cashier("POST", "/api/sales", { clientId: cid(), locationId: main, couponCode: "BIENVENIDA", items: [{ variantId: cv, quantity: 2 }], payments: [{ method: "cash", amountCents: 100000 }] })));
check("última redención del cupón en dos cajas a la vez: solo una", race.filter((x) => x.status === 201).length === 1 && race.some((x) => x.status === 409 || x.status === 422), race.map((x) => [x.status, x.data?.error?.code]));
r = await cashier("GET", "/api/promotions/coupons/check/BIENVENIDA");
check("cupón agotado", r.status === 422 && r.data.error.message.includes("agotó"), r.data);
r = await owner("PUT", `/api/promotions/coupons/${couponId}`, { code: "BIENVENIDA", kind: "percent", value: 1000, minSubtotalCents: 30000, maxUses: 1, channel: "all" });
check("no se baja el máximo por debajo de los usos", r.status === 422 && r.data.error.fields.maxUses, r.data);

console.log("Tienda en línea");
r = await owner("GET", "/api/promotions");
const promosLen = r.data.promotions.length;
check("lista de promociones con usos", promosLen === 3 && r.data.promotions.find((p) => p.id === promoRopa).uses === 2 && r.data.coupons[0].usesCount === 2, r.data);
r = await fetch(`${BASE}/api/store/${slug}`).then((x) => x.json());
check("la tienda recibe sus promociones vigentes", r.promotions.length === 2 && r.couponsEnabled === true, r.promotions.map((p) => p.name));
r = await fetch(`${BASE}/api/store/${slug}/products`).then((x) => x.json());
const cardCojin = r.items.find((p) => p.id === cojin.id), cardPlay = r.items.find((p) => p.id === playera.id);
check("precio antes y ahora en la tienda", cardCojin.fromPriceCents === 25500 && cardCojin.compareAtCents === 30000 && cardPlay.fromPriceCents === 16000, [cardCojin, cardPlay]);
r = await fetch(`${BASE}/api/store/${slug}/products/${cojin.id}`).then((x) => x.json());
check("detalle con la promoción", r.promotion?.percentBps === 1500, r.promotion);
await owner("POST", "/api/promotions/coupons", { code: "WEB50", kind: "amount", value: 5000, channel: "online" });
r = await fetch(`${BASE}/api/store/${slug}/coupons/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "web50" }) }).then(async (x) => ({ status: x.status, data: await x.json() }));
check("la tienda valida cupones", r.status === 200 && r.data.value === 5000, r.data);
r = await cashier("POST", "/api/sales", { clientId: cid(), locationId: main, couponCode: "WEB50", items: [{ variantId: cv, quantity: 1 }], payments: [{ method: "cash", amountCents: 50000 }] });
check("cupón solo en línea no sirve en caja", r.status === 422 && r.data.error.message.includes("en línea"), r.data);
const order = (email, extra) => fetch(`${BASE}/api/store/${slug}/orders`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ clientId: cid(), items: [{ variantId: cv, quantity: 2 }], fulfillment: "pickup", customerName: "Andrés G.", customerEmail: email, customerPhone: "5599990000", paymentMethod: "on_delivery", ...extra }),
}).then(async (x) => ({ status: x.status, data: await x.json() }));
// 2 × 300 − 15 % = 510 − 50 coupon = 460
r = await order("ANDRES@example.com", { couponCode: "web50", expectedTotalCents: 46000 });
check("pedido en línea con promoción y cupón", r.status === 201, r.data);
const t1 = r.data.token;
r = await fetch(`${BASE}/api/store/${slug}/orders/${t1}`).then((x) => x.json());
check("seguimiento muestra el descuento y el cupón", r.discountCents === 14000 && r.couponCode === "WEB50" && r.totalCents === 46000, r);
r = await order(`nueva-${stamp}@example.com`, { expectedTotalCents: 51000 });
check("pedido de un cliente nuevo", r.status === 201, r.data);
r = await owner("GET", `/api/customers?q=nueva-${stamp.toLowerCase()}`);
check("el cliente nuevo se crea solo desde la tienda", r.data.items.length === 1 && r.data.items[0].source === "online", r.data.items);
const orders = (await owner("GET", "/api/orders")).data.items;
const oAndres = orders.find((o) => o.customerName === "Andrés G." && o.totalCents === 46000).id;
await owner("POST", `/api/orders/${oAndres}/complete`, { payment: { method: "card", reference: null } });
r = await owner("GET", `/api/customers/${andres}`);
check("ficha del cliente: compras en caja y en línea", r.data.purchases === 2 && r.data.totalCents === 62000 + 46000 && r.data.history.length === 2 && r.data.history.some((h) => h.kind === "order"), r.data);
check("lo que más compra", r.data.topProducts[0]?.productId === cojin.id && r.data.topProducts[0].quantity === 3, r.data.topProducts);
r = await owner("GET", "/api/customers?sort=total");
check("orden por total comprado", r.data.items[0].id === andres, r.data.items.map((c) => c.name));
r = await owner("GET", "/api/customers/export");
check("exportar clientes en CSV", r.status === 200 && String(r.data).includes("Andrés Gómez") && r.headers.get("content-type").includes("text/csv"), String(r.data).slice(0, 120));
r = await owner("POST", `/api/customers/${andres}/archive`, { archived: true });
check("archivar cliente", r.status === 200 && r.data.archived === true, r.data);
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, customerId: "no-existe", items: [{ variantId: pv, quantity: 1 }], payments: [{ method: "cash", amountCents: 50000 }] });
check("cliente inexistente en una venta → 422", r.status === 422, r.data);

console.log("Cuentas por pagar");
const sup = (await owner("POST", "/api/suppliers", { name: "Telas del Norte", paymentTermsDays: 30 })).data.id;
const po = (await owner("POST", "/api/purchases", { supplierId: sup, locationId: main, items: [{ variantId: pv, quantity: 10, unitCostCents: 8000, taxRateBps: 1600 }] })).data;
await owner("POST", `/api/purchases/${po.id}/order`);
await owner("POST", `/api/purchases/${po.id}/receive`, { supplierReference: "FN-55", items: [{ orderItemId: po.items[0].id, quantity: 10, unitCostCents: 8000 }] });
r = await owner("GET", "/api/payables");
const inv = r.data.items[0];
check("la recepción genera la factura por pagar (neto + IVA)", r.data.items.length === 1 && inv.amountDueCents === 92800 && inv.balanceCents === 92800 && inv.dueDate === shift(today, 30) && inv.daysToDue === 30, inv);
check("resumen por proveedor", r.data.summary.openCents === 92800 && r.data.summary.overdueCents === 0 && r.data.summary.bySupplier[0].supplierName === "Telas del Norte", r.data.summary);
r = await owner("POST", `/api/payables/${inv.receiptId}/payments`, { amountCents: 100000, method: "transfer", paidOn: today });
check("pagar de más → 422 con el saldo", r.status === 422 && r.data.error.fields.amountCents.includes("928"), r.data);
r = await owner("POST", `/api/payables/${inv.receiptId}/payments`, { amountCents: 40000, method: "transfer", reference: "SPEI 1", paidOn: today });
check("pago parcial por transferencia", r.status === 201 && r.data.balanceCents === 52800, r.data);
r = await owner("POST", `/api/payables/${inv.receiptId}/payments`, { amountCents: 2800, method: "card", paidOn: today, fromCashDrawer: true });
check("solo el efectivo sale de la caja → 422", r.status === 422 && r.data.error.fields.method, r.data);
const cashBefore = (await owner("GET", `/api/cash/current?locationId=${main}`)).data.expectedCashCents;
r = await owner("POST", `/api/payables/${inv.receiptId}/payments`, { amountCents: 2800, method: "cash", paidOn: today, fromCashDrawer: true });
check("pago en efectivo desde la caja", r.status === 201, r.data);
r = await owner("GET", `/api/cash/current?locationId=${main}`);
check("el efectivo sale de la caja", r.data.expectedCashCents === cashBefore - 2800 && r.data.movements.some((m) => m.reason.includes("Telas del Norte")), r.data.movements);
const both = await Promise.all([1, 2].map(() => owner("POST", `/api/payables/${inv.receiptId}/payments`, { amountCents: 50000, method: "transfer", paidOn: today })));
check("dos pagos del saldo a la vez: solo uno", both.filter((x) => x.status === 201).length === 1 && both.some((x) => x.status === 409 || x.status === 422), both.map((x) => x.status));
r = await owner("GET", "/api/payables?status=paid");
check("factura liquidada con su historial de pagos", r.data.items.length === 1 && r.data.items[0].balanceCents === 0 && r.data.items[0].payments.length === 3, r.data.items[0]);
r = await cashier("GET", "/api/payables");
check("el cajero no ve cuentas por pagar → 403", r.status === 403, r.data);

console.log("Reportes");
r = await owner("GET", `/api/reports/sales?from=${today}&to=${today}`);
const rep = r.data;
const dash = (await owner("GET", "/api/reports/dashboard")).data;
check("ventas del periodo cuadran con el dashboard", r.status === 200 && rep.totals.netCents === dash.sales.totalCents && rep.totals.count === dash.sales.count, [rep.totals, dash.sales]);
check("incluye lo vendido en línea y las promociones", rep.totals.onlineCount === 1 && rep.totals.onlineCents === 46000 && rep.totals.promoDiscountCents === 8000 + 4000 + 6000 + 6000 + 14000, rep.totals);
check("utilidad sin impuestos", rep.totals.profitCents === rep.totals.netCents - rep.totals.taxCents - rep.totals.costCents && dash.sales.grossProfitCents === rep.totals.profitCents, rep.totals);
check("productos con utilidad", rep.products.length === 2 && rep.products.every((p) => typeof p.profitCents === "number"), rep.products);
check("por categoría", rep.categories.length === 2 && rep.categories.reduce((a, c) => a + c.netCents, 0) === rep.products.reduce((a, p) => a + p.netCents, 0), rep.categories);
const cash = rep.payments.find((p) => p.method === "cash");
check("formas de pago (efectivo neto de cambio)", cash && cash.amountCents === rep.cashiers.filter((x) => x.userId).reduce((a, x) => a + x.netCents, 0) && rep.payments.some((p) => p.method === "card" && p.amountCents === 46000), rep.payments);
check("por cajero y tienda en línea", rep.cashiers.some((x) => x.name === "Caro Caja") && rep.cashiers.some((x) => x.name === "Tienda en línea"), rep.cashiers);
check("uso de cupones", rep.coupons.find((x) => x.code === "BIENVENIDA").uses === 2 && rep.coupons.find((x) => x.code === "WEB50").uses === 1, rep.coupons);
check("ventas por hora (24 horas)", rep.hours.length === 24 && rep.hours.reduce((a, h) => a + h.count, 0) === rep.totals.count - rep.totals.onlineCount, rep.hours.filter((h) => h.count));
r = await owner("GET", `/api/reports/sales?from=${today}&to=${shift(today, -1)}`);
check("periodo al revés → 400", r.status === 400, r.data);
r = await owner("GET", "/api/reports/inventory?days=30");
check("inventario valorizado por categoría", r.status === 200 && r.data.valuation.length === 2 && r.data.totalCostCents > 0 && r.data.totalRetailCents > r.data.totalCostCents, r.data);
r = await cashier("GET", `/api/reports/sales?from=${today}&to=${today}`);
check("el cajero no ve reportes → 403", r.status === 403, r.data);

console.log("Aislamiento");
const other = client();
await other("POST", "/api/auth/register", { businessName: `Ajeno ${stamp}`, ownerName: "Otro", email: `ajeno-${stamp}@example.com`, password: "contrasena-segura-1" });
r = await other("GET", `/api/customers/${andres}`);
check("otro negocio no ve el cliente → 404", r.status === 404, r.data);
r = await other("GET", "/api/promotions/coupons/check/BIENVENIDA");
check("otro negocio no usa los cupones", r.status === 422 || r.status === 403, r.data);
r = await other("POST", `/api/payables/${inv.receiptId}/payments`, { amountCents: 1, method: "cash", paidOn: today });
check("otro negocio no paga facturas ajenas → 404", r.status === 404, r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
