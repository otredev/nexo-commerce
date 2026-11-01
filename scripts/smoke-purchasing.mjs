// End-to-end test of Phase 3 (suppliers, purchases, transfers, physical counts) against a running API.
// Usage: node scripts/smoke-purchasing.mjs [baseUrl]
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
await owner("POST", "/api/auth/register", { businessName: `Compras ${stamp}`, ownerName: "Ana Dueña", email: `ana-${stamp}@example.com`, password: "contrasena-segura-1" });
const main = (await owner("GET", "/api/locations")).data[0].id;
await owner("POST", "/api/taxes", { name: "IVA 16%", rateBps: 1600, isDefault: true, active: true });
const bodega = (await owner("POST", "/api/locations", { name: "Bodega", type: "warehouse", address: null, isDefault: false, active: true })).data.id;
const cat = (await owner("POST", "/api/categories", { name: "Bebidas" })).data.id;

const cafe = (await owner("POST", "/api/products", { name: "Café molido", categoryId: cat, variants: [{ sku: `CF-${stamp}`, barcode: `75${stamp}`, priceCents: 15000, costCents: 8000, initialStock: 4, minStock: 5 }] })).data;
const te = (await owner("POST", "/api/products", { name: "Té verde", categoryId: cat, variants: [{ priceCents: 9000, costCents: 4000, initialStock: 20, minStock: 3 }] })).data;
const azucar = (await owner("POST", "/api/products", { name: "Azúcar", unit: "kg", variants: [{ priceCents: 3500, costCents: 2000, initialStock: 0, minStock: 2 }] })).data;
const servicio = (await owner("POST", "/api/products", { name: "Molienda", unit: "service", trackInventory: false, variants: [{ priceCents: 1000 }] })).data;
const cv = cafe.variants[0].id, tv = te.variants[0].id, av = azucar.variants[0].id, sv = servicio.variants[0].id;
const skuOf = { [cv]: cafe.variants[0].sku, [tv]: te.variants[0].sku, [av]: azucar.variants[0].sku };
const stockOf = async (variantId, locationId) => (await owner("GET", `/api/inventory/lookup?locationId=${locationId}&q=${encodeURIComponent(skuOf[variantId])}`)).data[0]?.stock;
const costOf = async (productId) => (await owner("GET", `/api/products/${productId}`)).data.variants[0].costCents;

console.log("Proveedores");
let r = await owner("POST", "/api/suppliers", { name: "Distribuidora Sol", contactName: "Luis", email: "ventas@sol.example.com", paymentTermsDays: 30 });
check("crear proveedor", r.status === 201 && r.data.paymentTermsDays === 30, r.data);
const sol = r.data.id;
r = await owner("POST", "/api/suppliers", { name: "distribuidora sol" });
check("nombre duplicado (sin importar mayúsculas) → 409", r.status === 409 && r.data.error.fields?.name, r.data);
r = await owner("POST", "/api/suppliers", { name: "Proveedor sin correo", email: "" });
check("correo vacío se guarda como null", r.status === 201 && r.data.email === null, r.data);
const temporal = r.data.id;
r = await owner("PUT", `/api/suppliers/${sol}`, { name: "Distribuidora Sol", contactName: "Luis Pérez", email: "ventas@sol.example.com", paymentTermsDays: 15 });
check("editar proveedor", r.status === 200 && r.data.contactName === "Luis Pérez" && r.data.paymentTermsDays === 15, r.data);
r = await owner("DELETE", `/api/suppliers/${temporal}`);
check("eliminar proveedor sin órdenes", r.status === 204, r.data);

console.log("Buscador y sugerencias");
r = await owner("GET", `/api/inventory/lookup?locationId=${main}&q=75${stamp}`);
check("buscador por código de barras con existencia y costo", r.data[0]?.variantId === cv && r.data[0].exact && r.data[0].stock === 4 && r.data[0].costCents === 8000 && r.data[0].taxRateBps === 1600, r.data[0]);
r = await owner("GET", `/api/inventory/lookup?locationId=${main}&q=molienda`);
check("los servicios sin inventario no aparecen", r.data.length === 0, r.data);
r = await owner("GET", `/api/purchases/suggestions?locationId=${main}`);
const sugCafe = r.data.find((s) => s.variantId === cv);
const sugAz = r.data.find((s) => s.variantId === av);
check("sugerencia de reorden: lleva al doble del mínimo", sugCafe?.suggestedQuantity === 6 && sugAz?.suggestedQuantity === 4 && !r.data.find((s) => s.variantId === tv), r.data.map((s) => [s.name, s.suggestedQuantity]));

console.log("Órdenes de compra");
r = await owner("POST", "/api/purchases", { supplierId: sol, locationId: main, items: [{ variantId: sv, quantity: 1, unitCostCents: 100 }] });
check("no se compran productos sin inventario", r.status === 422, r.data);
r = await owner("POST", "/api/purchases", { supplierId: sol, locationId: main, items: [{ variantId: cv, quantity: 1, unitCostCents: 100 }, { variantId: cv, quantity: 2, unitCostCents: 100 }] });
check("producto repetido → 422", r.status === 422, r.data);
r = await owner("POST", "/api/purchases", { supplierId: sol, locationId: main, items: [{ variantId: cv, quantity: 1.5, unitCostCents: 100 }] });
check("piezas con decimales → 422", r.status === 422 && r.data.error.fields?.["items.0.quantity"], r.data);
r = await owner("POST", "/api/purchases", {
  supplierId: sol, locationId: main, expectedDate: "2026-11-10", note: "Entregar por la mañana",
  items: [{ variantId: cv, quantity: 10, unitCostCents: 9000, taxRateBps: 1600 }, { variantId: av, quantity: 2.5, unitCostCents: 1800, taxRateBps: 0 }],
});
const po = r.data;
// 10 × 90 = 900 (+144 IVA); 2.5 × 18 = 45
check("crear orden en borrador con folio", r.status === 201 && po.status === "draft" && po.number === 1 && po.subtotalCents === 94500 && po.taxCents === 14400 && po.totalCents === 108900, po);
check("la orden muestra existencia y costo actuales", po.items[0].stock === 4 && po.items[0].currentCostCents === 8000, po.items[0]);
r = await owner("POST", `/api/purchases/${po.id}/receive`, { items: [{ orderItemId: po.items[0].id, quantity: 1, unitCostCents: 9000 }] });
check("no se recibe un borrador → 409", r.status === 409 && r.data.error.code === "not_ordered", r.data);
r = await owner("PUT", `/api/purchases/${po.id}`, {
  supplierId: sol, locationId: main, expectedDate: "2026-11-10", note: "Entregar por la mañana",
  items: [{ variantId: cv, quantity: 12, unitCostCents: 9000, taxRateBps: 1600 }, { variantId: av, quantity: 2.5, unitCostCents: 1800, taxRateBps: 0 }],
});
check("editar borrador recalcula totales", r.status === 200 && r.data.subtotalCents === 112500 && r.data.items[0].quantity === 12, r.data);
const items = r.data.items;
r = await owner("POST", `/api/purchases/${po.id}/order`);
check("marcar como pedida", r.status === 200 && r.data.status === "ordered" && r.data.orderedAt, r.data);
r = await owner("POST", `/api/purchases/${po.id}/order`);
check("pedir dos veces → 409", r.status === 409, r.data);
r = await owner("POST", `/api/purchases/${po.id}/email`, { email: "ventas@sol.example.com", message: null });
check("enviar orden por correo", r.status === 200 && r.data.ok, r.data);

console.log("Recepciones");
r = await owner("POST", `/api/purchases/${po.id}/receive`, { items: [{ orderItemId: items[0].id, quantity: 13, unitCostCents: 9000 }] });
check("recibir más de lo pedido → 422", r.status === 422 && r.data.error.fields?.["items.0.quantity"], r.data);
r = await owner("POST", `/api/purchases/${po.id}/receive`, { items: [{ orderItemId: items[0].id, quantity: 0, unitCostCents: 9000 }] });
check("recepción vacía → 422", r.status === 422, r.data);
r = await owner("POST", `/api/purchases/${po.id}/receive`, { supplierReference: "F-1001", items: [{ orderItemId: items[0].id, quantity: 4, unitCostCents: 10000 }] });
check("recepción parcial con costo real distinto", r.status === 201 && r.data.status === "partial" && r.data.receivedCents === 40000 && r.data.receipts.length === 1, r.data);
check("vencimiento según días de crédito del proveedor (15)", r.data.receipts[0].dueDate > r.data.receipts[0].createdAt.slice(0, 10), r.data.receipts[0]);
check("existencia sube 4 → 8", await stockOf(cv, main) === 8);
// Weighted average: (4 × 80 + 4 × 100) / 8 = 90
check("costo promedio ponderado 80 → 90", await costOf(cafe.id) === 9000, await costOf(cafe.id));
r = await owner("GET", `/api/inventory/movements?variantId=${cv}&type=purchase`);
check("Kardex: entrada tipo compra con folio y factura", r.data.items.length === 1 && r.data.items[0].quantity === 4 && r.data.items[0].unitCostCents === 10000 && r.data.items[0].note.includes("OC-000001") && r.data.items[0].note.includes("F-1001"), r.data.items[0]);
r = await owner("PUT", `/api/purchases/${po.id}`, { supplierId: sol, locationId: main, items: [{ variantId: cv, quantity: 1, unitCostCents: 1 }] });
check("no se edita una orden con recepciones", r.status === 409, r.data);
r = await owner("POST", `/api/purchases/${po.id}/cancel`, { reason: "Ya no" });
check("no se cancela con recepciones (se cierra)", r.status === 409 && r.data.error.code === "has_receipts", r.data);

// Two receipts of the whole pending at the same time: only one can win.
const pending = { items: [{ orderItemId: items[0].id, quantity: 8, unitCostCents: 9000 }] };
const race = await Promise.all([owner("POST", `/api/purchases/${po.id}/receive`, pending), owner("POST", `/api/purchases/${po.id}/receive`, pending)]);
const won = race.filter((x) => x.status === 201).length;
check("dos recepciones simultáneas de lo pendiente: solo una entra", won === 1 && race.some((x) => x.status === 409 || x.status === 422), race.map((x) => [x.status, x.data?.error?.code]));
check("existencia 8 → 16, no 24", await stockOf(cv, main) === 16, await stockOf(cv, main));
r = await owner("GET", `/api/purchases/${po.id}`);
check("sigue parcial: falta el azúcar", r.data.status === "partial" && r.data.items[0].receivedQuantity === 12 && r.data.items[1].receivedQuantity === 0, r.data.items);
r = await owner("POST", `/api/purchases/${po.id}/receive`, { items: [{ orderItemId: items[1].id, quantity: 2.5, unitCostCents: 1800 }] });
check("al recibir todo pasa a recibida", r.status === 201 && r.data.status === "received" && r.data.closedAt && r.data.progress === 1, r.data);
check("kg con decimales: 0 → 2.5", await stockOf(av, main) === 2.5);
r = await owner("POST", `/api/purchases/${po.id}/receive`, { items: [{ orderItemId: items[1].id, quantity: 1, unitCostCents: 1800 }] });
check("no se recibe una orden cerrada → 409", r.status === 409, r.data);

r = await owner("POST", "/api/purchases", { supplierId: sol, locationId: main, items: [{ variantId: tv, quantity: 5, unitCostCents: 4000 }] });
const po2 = r.data;
check("folios consecutivos", po2.number === 2, po2.number);
await owner("POST", `/api/purchases/${po2.id}/order`);
await owner("POST", `/api/purchases/${po2.id}/receive`, { items: [{ orderItemId: po2.items[0].id, quantity: 3, unitCostCents: 4000 }] });
r = await owner("POST", `/api/purchases/${po2.id}/close`, { reason: "El proveedor no tiene más" });
check("cerrar orden parcial con pendientes", r.status === 200 && r.data.status === "received" && r.data.cancelReason === "El proveedor no tiene más", r.data);
r = await owner("POST", `/api/purchases/${po2.id}/duplicate`);
check("repetir pedido crea un borrador nuevo", r.status === 201 && r.data.status === "draft" && r.data.number === 3 && r.data.items[0].quantity === 5, r.data);
r = await owner("POST", `/api/purchases/${r.data.id}/cancel`, { reason: "Duplicado por error" });
check("cancelar borrador", r.status === 200 && r.data.status === "cancelled", r.data);
r = await owner("GET", "/api/purchases?status=open");
check("lista de órdenes abiertas vacía", r.data.total === 0, r.data);
r = await owner("GET", "/api/purchases?q=oc-000001");
check("buscar por folio", r.data.items.length === 1 && r.data.items[0].number === 1 && r.data.items[0].progress === 1, r.data.items);
r = await owner("GET", "/api/suppliers");
const solRow = r.data.find((s) => s.id === sol);
check("proveedor con historial de compras", solRow.ordersCount === 2 && solRow.receivedCents === 40000 + 72000 + 4500 + 12000, solRow);
r = await owner("DELETE", `/api/suppliers/${sol}`);
check("no se elimina un proveedor con órdenes", r.status === 409, r.data);

console.log("Traspasos");
r = await owner("POST", "/api/transfers", { fromLocationId: main, toLocationId: main, items: [{ variantId: cv, quantity: 1 }] });
check("origen y destino iguales → 422", r.status === 422 && r.data.error.fields?.toLocationId, r.data);
r = await owner("POST", "/api/transfers", { fromLocationId: main, toLocationId: bodega, note: "Surtir bodega", items: [{ variantId: cv, quantity: 6 }, { variantId: tv, quantity: 2 }] });
const tr = r.data;
check("crear traspaso en borrador", r.status === 201 && tr.status === "draft" && tr.number === 1 && tr.items[0].originStock === 16, tr);
r = await owner("POST", `/api/transfers/${tr.id}/receive`, { items: tr.items.map((i) => ({ itemId: i.id, receivedQuantity: i.quantity })) });
check("no se recibe un borrador → 409", r.status === 409, r.data);
const costBefore = await costOf(cafe.id);
r = await owner("POST", `/api/transfers/${tr.id}/send`);
check("enviar: sale del origen", r.status === 200 && r.data.status === "in_transit" && r.data.items[0].unitCostCents === costBefore, r.data);
check("origen 16 → 10, destino sin cambios", await stockOf(cv, main) === 10 && await stockOf(cv, bodega) === 0);
r = await owner("POST", `/api/transfers/${tr.id}/send`);
check("enviar dos veces → 409", r.status === 409, r.data);
r = await owner("POST", `/api/transfers/${tr.id}/receive`, { items: [{ itemId: tr.items[0].id, receivedQuantity: 7 }, { itemId: tr.items[1].id, receivedQuantity: 2 }] });
check("recibir más de lo enviado → 422", r.status === 422, r.data);
r = await owner("POST", `/api/transfers/${tr.id}/receive`, { items: [{ itemId: tr.items[0].id, receivedQuantity: 5 }, { itemId: tr.items[1].id, receivedQuantity: 2 }] });
check("recibir con una pieza faltante", r.status === 200 && r.data.status === "received" && r.data.items[0].receivedQuantity === 5, r.data);
check("destino recibe 5; el costo promedio no cambia", await stockOf(cv, bodega) === 5 && await costOf(cafe.id) === costBefore);
r = await owner("GET", `/api/inventory/movements?variantId=${cv}&type=transfer_out`);
check("Kardex: salida por traspaso con folio", r.data.items[0]?.quantity === -6 && r.data.items[0].note === "TR-000001", r.data.items[0]);

r = await owner("POST", "/api/transfers", { fromLocationId: bodega, toLocationId: main, items: [{ variantId: cv, quantity: 50 }] });
const big = r.data;
r = await owner("POST", `/api/transfers/${big.id}/send`);
check("enviar sin existencia suficiente → 409 con el producto", r.status === 409 && r.data.error.message.includes("Café molido"), r.data);
check("el fallo no movió nada", await stockOf(cv, bodega) === 5);
r = await owner("PUT", `/api/transfers/${big.id}`, { fromLocationId: bodega, toLocationId: main, items: [{ variantId: cv, quantity: 3 }] });
r = await owner("POST", `/api/transfers/${big.id}/send`);
check("enviar tras corregir", r.status === 200 && r.data.status === "in_transit", r.data);
r = await owner("POST", `/api/transfers/${big.id}/cancel`);
check("cancelar en tránsito regresa al origen", r.status === 200 && r.data.status === "cancelled" && await stockOf(cv, bodega) === 5, r.data);

// Concurrency: two sends of the same draft.
r = await owner("POST", "/api/transfers", { fromLocationId: main, toLocationId: bodega, items: [{ variantId: tv, quantity: 1 }] });
const twice = await Promise.all([owner("POST", `/api/transfers/${r.data.id}/send`), owner("POST", `/api/transfers/${r.data.id}/send`)]);
check("dos envíos simultáneos: solo uno descuenta", twice.filter((x) => x.status === 200).length === 1 && await stockOf(tv, main) === 20 - 2 - 1 + 3, twice.map((x) => x.status));

console.log("Conteos físicos");
await owner("POST", "/api/users", { name: "Carla Caja", email: `carla-${stamp}@example.com`, role: "cashier", password: "otra-contrasena-1" });
const cashier = client();
await cashier("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: "otra-contrasena-1" });
r = await cashier("POST", "/api/counts", { locationId: main, scope: "all" });
check("el cajero no inicia conteos → 403", r.status === 403, r.data);
r = await owner("POST", "/api/counts", { locationId: main, scope: "category", categoryId: null });
check("conteo por categoría exige la categoría", r.status === 422 && r.data.error.fields?.categoryId, r.data);
r = await owner("POST", "/api/counts", { locationId: main, scope: "category", categoryId: cat, note: "Pasillo 1" });
const count = r.data;
check("conteo de una categoría toma sus productos", r.status === 201 && count.lines === 2 && count.items.every((i) => i.expectedQuantity !== null), count);
const lineCafe = count.items.find((i) => i.variantId === cv);
const lineTe = count.items.find((i) => i.variantId === tv);
r = await cashier("GET", `/api/counts/${count.id}`);
check("conteo ciego: el cajero no ve la existencia esperada", r.status === 200 && r.data.showExpected === false && r.data.items.every((i) => i.expectedQuantity === null), r.data.items);
r = await cashier("POST", `/api/counts/${count.id}/entries`, { entries: [{ itemId: lineCafe.id, countedQuantity: 8 }] });
check("el cajero captura lo contado", r.status === 200 && r.data.items.find((i) => i.id === lineCafe.id).countedQuantity === 8 && r.data.counted === 1, r.data);
r = await cashier("POST", `/api/counts/${count.id}/entries`, { entries: [{ itemId: lineTe.id, countedQuantity: 1.5 }] });
check("piezas con decimales → 422", r.status === 422, r.data);
// Sell 2 coffees AFTER they were counted: the final adjustment must keep that sale.
await owner("POST", "/api/cash/open", { locationId: main, openingCashCents: 0 });
r = await owner("POST", "/api/sales", { clientId: cid(), locationId: main, items: [{ variantId: cv, quantity: 2 }], payments: [{ method: "cash", amountCents: 30000 }] });
check("venta durante el conteo", r.status === 201, r.data);
r = await owner("POST", `/api/counts/${count.id}/items`, { variantIds: [av] });
check("agregar un producto encontrado durante el conteo", r.status === 200 && r.data.lines === 3, r.data);
const lineAz = r.data.items.find((i) => i.variantId === av);
await owner("POST", `/api/counts/${count.id}/entries`, { entries: [{ itemId: lineAz.id, countedQuantity: 2.5 }] });
r = await cashier("POST", `/api/counts/${count.id}/complete`, { zeroUncounted: false });
check("el cajero no aplica conteos → 403", r.status === 403, r.data);
const valueCost = await costOf(cafe.id);
r = await owner("POST", `/api/counts/${count.id}/complete`, { zeroUncounted: false });
const done = r.data;
// Coffee: 10 in system when counted, 8 counted → −2; then 2 sold → final 8 − 2 = 6.
check("aplicar conteo", r.status === 200 && done.status === "completed" && done.summary.adjusted === 1 && done.summary.unitsShort === 2, done);
check("la venta posterior al conteo se respeta (10 → contado 8 → vendió 2 → 6)", await stockOf(cv, main) === 6, await stockOf(cv, main));
check("té sin contar queda igual", await stockOf(tv, main) === 20 - 2 - 1 + 3, await stockOf(tv, main));
check("valor de la diferencia a costo promedio", done.summary.valueDeltaCents === -2 * valueCost, done.summary);
r = await owner("GET", `/api/inventory/movements?variantId=${cv}&type=adjust`);
check("Kardex: un ajuste por conteo con folio y saldo", r.data.items.length === 1 && r.data.items[0].quantity === -2 && r.data.items[0].balanceAfter === 6 && r.data.items[0].note === "CF-000001" && r.data.items[0].reason === "stock_count", r.data.items);
r = await owner("GET", `/api/inventory/movements?variantId=${av}&type=adjust`);
check("sin diferencia no hay movimiento", r.data.items.length === 0, r.data.items);
r = await owner("POST", `/api/counts/${count.id}/entries`, { entries: [{ itemId: lineCafe.id, countedQuantity: 1 }] });
check("un conteo aplicado ya no se edita → 409", r.status === 409, r.data);

r = await owner("POST", "/api/counts", { locationId: bodega, scope: "all" });
const c2 = r.data;
check("conteo completo de la bodega", r.status === 201 && c2.lines === 3, c2);
const both = await Promise.all([owner("POST", `/api/counts/${c2.id}/complete`, { zeroUncounted: true }), owner("POST", `/api/counts/${c2.id}/complete`, { zeroUncounted: true })]);
check("aplicar dos veces al mismo tiempo: solo una", both.filter((x) => x.status === 200).length === 1, both.map((x) => x.status));
check("lo no contado se lleva a cero", await stockOf(cv, bodega) === 0 && await stockOf(tv, bodega) === 0, [await stockOf(cv, bodega), await stockOf(tv, bodega)]);
r = await owner("POST", "/api/counts", { locationId: main, scope: "manual" });
check("conteo manual empieza vacío", r.status === 201 && r.data.lines === 0, r.data);
r = await owner("POST", `/api/counts/${r.data.id}/complete`, { zeroUncounted: false });
check("no se aplica un conteo sin nada contado", r.status === 422, r.data);
r = await owner("GET", "/api/counts?status=completed");
check("lista de conteos aplicados con resumen", r.data.total === 2 && r.data.items[0].summary !== null, r.data);

console.log("Permisos y aislamiento");
r = await cashier("GET", "/api/purchases");
check("el cajero no ve compras (costos) → 403", r.status === 403, r.data);
r = await cashier("GET", "/api/suppliers");
check("el cajero no ve proveedores → 403", r.status === 403, r.data);
r = await cashier("GET", `/api/transfers/${tr.id}`);
check("el cajero ve traspasos sin costos", r.status === 200 && r.data.items.every((i) => i.unitCostCents === null), r.data.items);
const other = client();
await other("POST", "/api/auth/register", { businessName: `Otro ${stamp}`, ownerName: "Otro", email: `otro-${stamp}@example.com`, password: "contrasena-segura-1" });
r = await other("GET", `/api/purchases/${po.id}`);
check("otro negocio no ve la orden → 404", r.status === 404, r.data);
r = await other("POST", `/api/transfers/${tr.id}/cancel`);
check("otro negocio no toca el traspaso → 404", r.status === 404, r.data);
r = await other("GET", "/api/suppliers");
check("otro negocio no ve los proveedores", r.status === 200 && r.data.length === 0, r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
