// End-to-end test of Phase 1 (catalog + inventory) against a running API.
// Usage: node scripts/smoke-catalog.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;

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
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); }
}

const owner = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Tienda ${stamp}`, ownerName: "Ana Dueña", email: `ana-${stamp}@example.com`, password: "contrasena-segura-1" });
if (r.status !== 201) { console.log("No se pudo registrar", r); process.exit(1); }
const locations = (await owner("GET", "/api/locations")).data;
const main = locations[0].id;
const bodega = (await owner("POST", "/api/locations", { name: "Bodega", type: "warehouse", address: null, isDefault: false, active: true })).data.id;
const iva = (await owner("POST", "/api/taxes", { name: "IVA 16%", rateBps: 1600, isDefault: true, active: true })).data.id;

console.log("Categorías y marcas");
r = await owner("POST", "/api/categories", { name: "Ropa" });
check("crear categoría", r.status === 201, r.data);
const ropa = r.data.id;
r = await owner("POST", "/api/categories", { name: "ropa" });
check("duplicado sin importar mayúsculas → 409", r.status === 409, r.data);
const marca = (await owner("POST", "/api/brands", { name: "Olivo" })).data.id;
check("crear marca", Boolean(marca));

console.log("Productos");
r = await owner("POST", "/api/products", {
  name: "Taza de cerámica", categoryId: null, unit: "unit",
  variants: [{ sku: `TAZ-${stamp}`, barcode: `750${stamp}`, priceCents: 18500, costCents: 9000, minStock: 5, initialStock: 12 }],
});
check("producto simple con stock inicial", r.status === 201 && r.data.variants[0].stock === 12 && r.data.variants[0].costCents === 9000, r.data);
const taza = r.data;
r = await owner("POST", "/api/products", {
  name: "Camisa de lino", categoryId: ropa, brandId: marca, taxRateId: iva, optionNames: ["Talla", "Color"],
  variants: [
    { options: ["M", "Blanco"], priceCents: 59000, costCents: 30000, initialStock: 4 },
    { options: ["L", "Blanco"], priceCents: 59000, costCents: 30000, initialStock: 0 },
    { options: ["M", "Negro"], priceCents: 62000, costCents: 31000 },
  ],
});
check("producto con variantes y SKU automático", r.status === 201 && r.data.variants.length === 3 && r.data.variants.every((v) => /^CAM-/.test(v.sku)), r.data);
const camisa = r.data;
r = await owner("POST", "/api/products", { name: "Otra", variants: [{ sku: `taz-${stamp}`, priceCents: 100 }] });
check("SKU repetido (otro producto, sin importar mayúsculas) → 422", r.status === 422 && r.data.error.fields["variants.0.sku"], r.data);
r = await owner("POST", "/api/products", { name: "Otra", variants: [{ barcode: `750${stamp}`, priceCents: 100 }] });
check("código de barras repetido → 422", r.status === 422 && r.data.error.fields["variants.0.barcode"], r.data);
r = await owner("POST", "/api/products", { name: "Combinaciones", optionNames: ["Talla"], variants: [{ options: ["M"], priceCents: 1 }, { options: ["m"], priceCents: 1 }] });
check("combinación repetida → 422", r.status === 422, r.data);
r = await owner("POST", "/api/products", { name: "Tela", unit: "m", variants: [{ priceCents: 8000, costCents: 3000, initialStock: 25.5, minStock: 10 }] });
check("unidad con decimales (metros)", r.status === 201 && r.data.variants[0].stock === 25.5, r.data);
const tela = r.data;
r = await owner("POST", "/api/products", { name: "Vaso", unit: "unit", variants: [{ priceCents: 100, initialStock: 1.5 }] });
check("piezas no aceptan decimales → 422", r.status === 422 && r.data.error.fields["variants.0.initialStock"], r.data);
r = await owner("POST", "/api/products", { name: "Envoltura de regalo", unit: "service", trackInventory: false, variants: [{ priceCents: 3000 }] });
check("servicio sin inventario", r.status === 201 && r.data.variants[0].stockStatus === "untracked", r.data);

console.log("Lista, búsqueda y filtros");
r = await owner("GET", "/api/products?q=CAMISA");
check("buscar por nombre sin importar mayúsculas", r.data.total === 1 && r.data.items[0].name === "Camisa de lino", r.data);
r = await owner("GET", "/api/products?q=ceramica");
check("buscar sin acentos", r.data.total === 1, r.data);
r = await owner("GET", `/api/products?q=750${stamp}`);
check("buscar por código de barras", r.data.total === 1 && r.data.items[0].id === taza.id, r.data);
r = await owner("GET", `/api/products?categoryId=${ropa}`);
check("filtrar por categoría", r.data.total === 1, r.data);
r = await owner("GET", "/api/products?stock=out");
check("filtro agotados (variantes en 0)", r.data.items.some((p) => p.id === camisa.id) && !r.data.items.some((p) => p.id === taza.id), r.data);
r = await owner("GET", "/api/products?pageSize=2&page=2");
check("paginación", r.data.items.length === 2 && r.data.total === 4 && r.data.page === 2, r.data);
const camisaRow = (await owner("GET", "/api/products?q=camisa")).data.items[0];
check("rango de precios y stock total", camisaRow.priceMin === 59000 && camisaRow.priceMax === 62000 && camisaRow.stock === 4 && camisaRow.variantCount === 3, camisaRow);

console.log("Movimientos (Kardex)");
const tv = taza.variants[0].id;
r = await owner("POST", "/api/inventory/movements", { variantId: tv, locationId: main, type: "in", quantity: 8, unitCostCents: 11500, reason: "purchase" });
check("entrada con costo", r.status === 201 && r.data.quantity === 20, r.data);
r = await owner("GET", `/api/products/${taza.id}`);
check("costo promedio ponderado (12×90 + 8×115) / 20 = 100", r.data.variants[0].costCents === 10000, r.data.variants[0]);
r = await owner("POST", "/api/inventory/movements", { variantId: tv, locationId: main, type: "out", quantity: 3, reason: "damage", note: "Se rompieron" });
check("salida", r.status === 201 && r.data.quantity === 17, r.data);
r = await owner("POST", "/api/inventory/movements", { variantId: tv, locationId: main, type: "out", quantity: 50, reason: "loss" });
check("salida mayor al stock → 409 sin cambios", r.status === 409 && r.data.error.code === "insufficient_stock", r.data);
r = await owner("POST", "/api/inventory/movements", { variantId: tv, locationId: bodega, type: "out", quantity: 1, reason: "loss" });
check("salida en ubicación sin stock → 409", r.status === 409, r.data);
r = await owner("POST", "/api/inventory/movements", { variantId: tv, locationId: main, type: "set", quantity: 15, reason: "count" });
check("ajuste por conteo", r.status === 201 && r.data.quantity === 15, r.data);
r = await owner("POST", "/api/inventory/movements", { variantId: tv, locationId: main, type: "in", quantity: 1, reason: "damage" });
check("motivo que no corresponde → 422", r.status === 422, r.data);
r = await owner("POST", "/api/inventory/movements", { variantId: tv, locationId: bodega, type: "in", quantity: 6, reason: "purchase", unitCostCents: null });
check("entrada a la bodega", r.status === 201 && r.data.quantity === 6, r.data);
r = await owner("GET", `/api/inventory/movements?variantId=${tv}`);
const kardex = r.data.items;
check("Kardex completo y en orden", kardex.map((m) => m.type).join(",") === "in,adjust,out,in,initial", kardex.map((m) => m.type));
check("saldo después de cada movimiento", kardex.map((m) => m.balanceAfter).join(",") === "6,15,17,20,12", kardex.map((m) => m.balanceAfter));
check("ajuste registra la diferencia", kardex[1].quantity === -2, kardex[1]);
check("salida guarda el costo del momento", kardex[2].quantity === -3 && kardex[2].unitCostCents === 10000 && kardex[2].note === "Se rompieron", kardex[2]);
check("usuario en cada movimiento", kardex.every((m) => m.userName === "Ana Dueña"), kardex);
r = await owner("GET", `/api/inventory?locationId=${bodega}&q=taza`);
check("inventario por ubicación", r.data.items[0]?.quantity === 6, r.data);
r = await owner("GET", "/api/inventory?q=taza");
check("inventario total (todas las ubicaciones)", r.data.items[0]?.quantity === 21, r.data);

console.log("Concurrencia: nunca se vende lo que no hay");
const telaVariant = tela.variants[0].id;
const results = await Promise.all(Array.from({ length: 12 }, () => owner("POST", "/api/inventory/movements", { variantId: telaVariant, locationId: main, type: "out", quantity: 2.5, reason: "internal_use" })));
const ok = results.filter((x) => x.status === 201).length;
const rejected = results.filter((x) => x.status === 409).length;
r = await owner("GET", `/api/products/${tela.id}`);
check("12 salidas simultáneas de 2.5 m con 25.5 m: 10 pasan, 2 se rechazan", ok === 10 && rejected === 2, { ok, rejected, other: results.filter((x) => x.status !== 201 && x.status !== 409) });
check("stock final exacto (0.5 m), nunca negativo", r.data.variants[0].stock === 0.5, r.data.variants[0]);
r = await owner("GET", `/api/inventory/movements?variantId=${telaVariant}&limit=200`);
check("Kardex cuadra con el stock", r.data.items[0].balanceAfter === 0.5 && r.data.items.length === 11, r.data.items.length);

console.log("Edición de productos");
const editBody = (p, patch = {}) => ({
  name: p.name, description: p.description, categoryId: p.categoryId, brandId: p.brandId, taxRateId: p.taxRateId,
  unit: p.unit, trackInventory: p.trackInventory, optionNames: p.optionNames, images: p.images,
  variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode, options: v.options, priceCents: v.priceCents, costCents: v.costCents ?? 0, minStock: v.minStock, active: v.active })),
  ...patch,
});
const cam = (await owner("GET", `/api/products/${camisa.id}`)).data;
r = await owner("PUT", `/api/products/${cam.id}`, editBody(cam, { variants: editBody(cam).variants.filter((v) => v.options[0] !== "M" || v.options[1] !== "Blanco") }));
check("no se elimina una variante con stock → 409", r.status === 409 && r.data.error.code === "variant_has_stock", r.data);
const body = editBody(cam);
body.variants = body.variants.filter((v) => !(v.options[0] === "L")); // L/Blanco has 0 stock
body.variants.push({ options: ["S", "Blanco"], priceCents: 57000, costCents: 29000, minStock: 1, initialStock: 2 });
body.variants[0].priceCents = 61000;
body.name = "Camisa de lino premium";
r = await owner("PUT", `/api/products/${cam.id}`, body);
check("editar: quita variante sin stock, agrega otra con stock y cambia precio", r.status === 200 && r.data.variants.length === 3 && r.data.variants.some((v) => v.options[0] === "S" && v.stock === 2) && r.data.variants[0].priceCents === 61000, r.data);
r = await owner("PUT", `/api/products/${tela.id}`, editBody((await owner("GET", `/api/products/${tela.id}`)).data, { unit: "kg" }));
check("no cambia la unidad con existencias → 422", r.status === 422 && r.data.error.fields.unit, r.data);
r = await owner("POST", `/api/products/${taza.id}/archive`);
check("archivar", r.status === 200);
r = await owner("GET", "/api/products?q=taza");
check("archivados no salen en activos", r.data.total === 0);
r = await owner("GET", "/api/products?q=taza&status=archived");
check("pero sí en archivados", r.data.total === 1);
await owner("POST", `/api/products/${taza.id}/restore`);
r = await owner("DELETE", `/api/products/${taza.id}`);
check("no se elimina con existencias → 409", r.status === 409, r.data);

console.log("Importación CSV");
r = await owner("POST", "/api/products/import", {
  products: [
    { name: "Jabón artesanal", categoryName: "Cuidado personal", brandName: "Olivo", taxPercent: 16, variants: [{ sku: `JAB-${stamp}`, priceCents: 9500, costCents: 4000, initialStock: 30, minStock: 5 }], rows: [2] },
    { name: "Calcetines", categoryName: "ropa", optionNames: ["Talla"], variants: [{ options: ["CH"], priceCents: 9000, initialStock: 10 }, { options: ["G"], priceCents: 9000 }], rows: [3, 4] },
    { name: "Duplicado", variants: [{ sku: `TAZ-${stamp}`, priceCents: 100 }], rows: [5] },
    { name: "Impuesto raro", taxPercent: 7, variants: [{ priceCents: 100 }], rows: [6] },
    { name: "", variants: [{ priceCents: 100 }], rows: [7] },
  ],
});
check("importa válidos y reporta errores por fila", r.status === 200 && r.data.created === 3 && r.data.errors.length === 2, r.data);
check("errores con número de fila", r.data.errors.map((e) => e.rows[0]).join(",") === "5,7", r.data.errors);
check("crea el impuesto que no existía", r.data.createdTaxes.join() === "Impuesto 7 %", r.data);
r = await owner("GET", "/api/categories");
check("crea categorías nuevas y reutiliza existentes (sin duplicar 'ropa')", r.data.length === 2 && r.data.find((x) => x.name === "Ropa").productCount === 2, r.data);
r = await owner("GET", "/api/products?q=jabon");
check("producto importado con stock", r.data.items[0]?.stock === 30, r.data);
r = await owner("GET", "/api/inventory/movements?type=initial&limit=200");
check("importación queda en el Kardex", r.data.items.some((m) => m.reason === "import"), r.data.items.map((m) => m.reason));

console.log("Resumen e inventario");
r = await owner("GET", "/api/inventory/summary");
check("resumen", r.status === 200 && r.data.products === 7 && r.data.outOfStock >= 1 && r.data.inventoryValueCents > 0, r.data);
r = await owner("GET", "/api/inventory?stock=low");
check("filtro stock bajo", r.data.items.some((i) => i.sku.startsWith("CAM-")), r.data.items.map((i) => i.sku));

console.log("Permisos del cajero");
await owner("POST", "/api/users", { name: "Luis Caja", email: `luis-${stamp}@example.com`, role: "cashier", password: "otra-contrasena-1" });
const cashier = client();
await cashier("POST", "/api/auth/login", { email: `luis-${stamp}@example.com`, password: "otra-contrasena-1" });
r = await cashier("GET", `/api/products/${taza.id}`);
check("cajero ve productos sin costos", r.status === 200 && r.data.variants[0].costCents === null, r.data.variants?.[0]);
r = await cashier("GET", "/api/inventory/summary");
check("cajero no ve el valor del inventario", r.data.inventoryValueCents === null, r.data);
r = await cashier("POST", "/api/products", { name: "X", variants: [{ priceCents: 1 }] });
check("cajero no crea productos → 403", r.status === 403);
r = await cashier("POST", "/api/inventory/movements", { variantId: tv, locationId: main, type: "in", quantity: 1, reason: "purchase" });
check("cajero no mueve inventario → 403", r.status === 403);

console.log("Aislamiento");
const other = client();
await other("POST", "/api/auth/register", { businessName: `Otro ${stamp}`, ownerName: "Beto", email: `beto-${stamp}@example.com`, password: "contrasena-segura-1" });
r = await other("GET", `/api/products/${taza.id}`);
check("otro negocio no ve el producto → 404", r.status === 404);
r = await other("GET", "/api/products");
check("otro negocio tiene catálogo vacío", r.data.total === 0);
const otherLoc = (await other("GET", "/api/locations")).data[0].id;
r = await other("POST", "/api/inventory/movements", { variantId: tv, locationId: otherLoc, type: "in", quantity: 1, reason: "purchase" });
check("no puede mover stock ajeno → 404", r.status === 404);
r = await other("POST", "/api/products", { name: "Mismo SKU en otro negocio", variants: [{ sku: `TAZ-${stamp}`, priceCents: 100 }] });
check("el SKU solo es único dentro del negocio", r.status === 201, r.data);

console.log("Auditoría");
r = await owner("GET", "/api/audit?limit=100");
const actions = new Set(r.data.items.map((i) => i.action));
check("registra creación, edición, archivo e importación", ["product.create", "product.update", "product.archive", "product.import", "category.create"].every((a) => actions.has(a)), [...actions]);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
