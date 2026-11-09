// End-to-end test of subcategories and keywords against a running API in development: one level of
// subcategories (rules, filters that include them, promotions, counts, CSV import) and keywords (search,
// filter, list in the panel, facets and filter in the online store).
//   node scripts/smoke-subcategories.mjs [http://localhost:8787]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}

function client() {
  const jar = new Map();
  return async (method, path, body) => {
    const h = {};
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let payload;
    if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";");
      const [k, ...v] = pair.split("=");
      if (attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim())) || !v.join("=")) jar.delete(k.trim()); else jar.set(k.trim(), v.join("="));
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
}

const owner = client(), shopper = client();
await owner("POST", "/api/auth/register", { businessName: `Boutique ${stamp}`, ownerName: "Sofía Dueña", email: `sofia-${stamp}@example.com`, password: "contrasena-segura-1" });
await owner("POST", "/api/dev/plan", { plan: "business" });
const slug = (await owner("GET", "/api/me")).data.tenant.slug;
const main = (await owner("GET", "/api/locations")).data[0].id;

/* ---------------- Categories and subcategories ---------------- */
console.log("Subcategorías");
const ropa = (await owner("POST", "/api/categories", { name: "Ropa" })).data;
const hogar = (await owner("POST", "/api/categories", { name: "Hogar" })).data;
let r = await owner("POST", "/api/categories", { name: "Camisas", parentId: ropa.id });
const camisas = r.data;
check("crear subcategoría", r.status === 201 && camisas.parentId === ropa.id, r.data);
r = await owner("POST", "/api/categories", { name: "Camisas", parentId: hogar.id });
const camisasHogar = r.data;
check("mismo nombre bajo otro padre está permitido", r.status === 201, r.data);
r = await owner("POST", "/api/categories", { name: "camisas", parentId: ropa.id });
check("mismo nombre en el mismo padre → 409", r.status === 409 && r.data.error.fields.name, r.data);
r = await owner("POST", "/api/categories", { name: "ROPA" });
check("categoría principal repetida → 409", r.status === 409, r.data);
r = await owner("POST", "/api/categories", { name: "Mangas", parentId: camisas.id });
check("solo un nivel: no hay sub-subcategorías → 422", r.status === 422 && r.data.error.fields.parentId, r.data);
r = await owner("POST", "/api/categories", { name: "Fantasma", parentId: "no-existe" });
check("padre inexistente → 422", r.status === 422 && r.data.error.fields.parentId, r.data);
r = await owner("PUT", `/api/categories/${ropa.id}`, { name: "Ropa", parentId: hogar.id });
check("una categoría con subcategorías no puede volverse subcategoría → 422", r.status === 422 && r.data.error.fields.parentId, r.data);
r = await owner("PUT", `/api/categories/${hogar.id}`, { name: "Hogar", parentId: hogar.id });
check("no puede estar dentro de sí misma → 422", r.status === 422, r.data);
r = await owner("POST", "/api/categories", { name: "Pantalones" });
const pantalones = r.data;
r = await owner("PUT", `/api/categories/${pantalones.id}`, { name: "Pantalones", parentId: ropa.id });
check("mover una categoría dentro de otra", r.status === 200 && r.data.parentId === ropa.id, r.data);
r = await owner("GET", "/api/categories");
check("la lista trae parentId", r.status === 200 && r.data.length === 5 && r.data.find((c) => c.id === pantalones.id).parentId === ropa.id && r.data.find((c) => c.id === ropa.id).parentId === null, r.data);

/* ---------------- Products with keywords ---------------- */
console.log("Productos y palabras clave");
r = await owner("POST", "/api/products", { name: "Camisa de lino", categoryId: camisas.id, online: true, keywords: ["Verano", "#Lino", "verano"], variants: [{ sku: `CL-${stamp}`, priceCents: 59000, initialStock: 5 }] });
const camisa = r.data;
check("palabras clave normalizadas y sin repetir", r.status === 201 && JSON.stringify(camisa.keywords) === JSON.stringify(["verano", "lino"]), r.data);
const pantalon = (await owner("POST", "/api/products", { name: "Pantalón chino", categoryId: pantalones.id, online: true, keywords: "verano, algodón", variants: [{ sku: `PC-${stamp}`, priceCents: 79000, initialStock: 2 }] })).data;
check("acepta las palabras clave como texto separado por comas", JSON.stringify(pantalon.keywords) === JSON.stringify(["verano", "algodón"]), pantalon.keywords);
const playera = (await owner("POST", "/api/products", { name: "Playera básica", categoryId: ropa.id, online: true, variants: [{ sku: `PB-${stamp}`, priceCents: 25000, initialStock: 9 }] })).data;
const cojin = (await owner("POST", "/api/products", { name: "Cojín", categoryId: camisasHogar.id, online: true, keywords: ["algodón"], variants: [{ sku: `CO-${stamp}`, priceCents: 30000, initialStock: 4 }] })).data;
r = await owner("POST", "/api/products", { name: "Demasiadas", keywords: Array.from({ length: 21 }, (_, i) => `k${i}`), variants: [{ priceCents: 1 }] });
check("más de 20 palabras clave → 422", r.status === 422 && r.data.error.fields.keywords, r.data);

r = await owner("GET", `/api/products?categoryId=${ropa.id}`);
check("filtrar por categoría incluye sus subcategorías", r.data.total === 3 && [camisa.id, pantalon.id, playera.id].every((id) => r.data.items.some((p) => p.id === id)), r.data.items?.map((p) => p.name));
r = await owner("GET", `/api/products?categoryId=${camisas.id}`);
check("filtrar por subcategoría solo trae la subcategoría", r.data.total === 1 && r.data.items[0].id === camisa.id, r.data.items?.map((p) => p.name));
check("la lista muestra «Padre › Subcategoría» y las palabras clave", r.data.items[0].category === "Ropa › Camisas" && r.data.items[0].keywords.includes("lino"), r.data.items[0]);
r = await owner("GET", "/api/products?keyword=VERANO");
check("filtrar por palabra clave (sin importar mayúsculas)", r.data.total === 2, r.data.items?.map((p) => p.name));
r = await owner("GET", `/api/products?keyword=algodón&categoryId=${ropa.id}`);
check("palabra clave + categoría se combinan", r.data.total === 1 && r.data.items[0].id === pantalon.id, r.data.items?.map((p) => p.name));
r = await owner("GET", "/api/products?q=lino");
check("la búsqueda encuentra por palabra clave", r.data.total === 1 && r.data.items[0].id === camisa.id, r.data.items?.map((p) => p.name));
r = await owner("GET", "/api/products/keywords");
check("palabras clave en uso con su conteo", r.status === 200 && r.data.items.find((k) => k.keyword === "verano")?.count === 2 && r.data.items.find((k) => k.keyword === "algodón")?.count === 2, r.data);

r = await owner("GET", `/api/products/${camisa.id}`);
const detail = r.data;
r = await owner("PUT", `/api/products/${camisa.id}`, { ...detail, keywords: ["fiesta"], variants: detail.variants.map((v) => ({ ...v, initialStock: undefined })) });
check("editar palabras clave", r.status === 200 && JSON.stringify(r.data.keywords) === '["fiesta"]', r.data);
r = await owner("GET", "/api/products?q=verano");
check("la búsqueda deja de encontrar la palabra quitada", r.data.total === 1 && r.data.items[0].id === pantalon.id, r.data.items?.map((p) => p.name));
check("y encuentra la nueva", (await owner("GET", "/api/products?q=fiesta")).data.total === 1);

r = await owner("GET", `/api/inventory?categoryId=${ropa.id}`);
check("inventario por categoría incluye subcategorías", r.status === 200 && new Set(r.data.items.map((i) => i.productId)).size === 3, r.data.items?.map((i) => i.productName));
r = await owner("GET", `/api/pos/products?locationId=${main}&categoryId=${ropa.id}`);
check("punto de venta por categoría incluye subcategorías", r.status === 200 && new Set(r.data.map((p) => p.productId)).size === 3, r.data);
r = await owner("POST", "/api/counts", { locationId: main, scope: "category", categoryId: ropa.id });
check("conteo de una categoría incluye sus subcategorías", r.status === 201 && r.data.lines === 3, r.data);
if (r.data?.id) await owner("POST", `/api/counts/${r.data.id}/cancel`);

/* ---------------- Promotions ---------------- */
console.log("Promociones");
r = await owner("POST", "/api/promotions", { name: "Ropa −10", percentBps: 1000, target: "category", targetIds: [ropa.id], channel: "all" });
check("crear promoción de la categoría principal", r.status === 201, r.data);
r = await owner("GET", "/api/promotions/live");
const live = r.data.find?.((p) => p.name === "Ropa −10");
check("una promoción de categoría cubre sus subcategorías", live && [ropa.id, camisas.id, pantalones.id].every((id) => live.targetIds.includes(id)) && !live.targetIds.includes(camisasHogar.id), r.data);

/* ---------------- Online store ---------------- */
console.log("Tienda en línea");
const settings = (await owner("GET", "/api/store-settings")).data;
delete settings.slug; delete settings.url; delete settings.publishedCount; delete settings.activeCount;
r = await owner("PUT", "/api/store-settings", { ...settings, enabled: true, locationId: main, accountRequired: false });
check("activar la tienda", r.status === 200, r.data);
r = await shopper("GET", `/api/store/${slug}`);
const info = r.data;
const sRopa = info.categories?.find((c) => c.id === ropa.id);
check("categorías con parentId; el padre cuenta los productos de sus subcategorías", sRopa?.count === 3 && sRopa.parentId === null && info.categories.find((c) => c.id === camisas.id)?.parentId === ropa.id, info.categories);
check("las vacías no aparecen", !info.categories.some((c) => c.count === 0), info.categories);
check("palabras clave más usadas como filtros", info.keywords?.find((k) => k.keyword === "algodón")?.count === 2 && info.keywords.some((k) => k.keyword === "fiesta"), info.keywords);
r = await shopper("GET", `/api/store/${slug}/products?categoryId=${ropa.id}`);
check("la tienda filtra la categoría con sus subcategorías", r.data.total === 3, r.data.items?.map((p) => p.name));
r = await shopper("GET", `/api/store/${slug}/products?keyword=algod%C3%B3n`);
check("la tienda filtra por palabra clave", r.data.total === 2, r.data.items?.map((p) => p.name));
r = await shopper("GET", `/api/store/${slug}/products?q=fiesta`);
check("la búsqueda de la tienda encuentra por palabra clave", r.data.total === 1, r.data.items?.map((p) => p.name));
r = await shopper("GET", `/api/store/${slug}/products/${pantalon.id}`);
check("el producto trae su ruta de categorías y palabras clave", r.data.categoryName === "Pantalones" && r.data.parentCategoryName === "Ropa" && r.data.parentCategoryId === ropa.id && r.data.keywords.includes("verano"), r.data);
check("el precio de la subcategoría lleva la promoción del padre", r.data.promotion?.name === "Ropa −10", r.data.promotion);
r = await shopper("GET", `/api/store/${slug}/products/${cojin.id}`);
check("otra «Camisas» (de Hogar) no lleva la promoción", r.data.promotion === null && r.data.parentCategoryName === "Hogar", r.data);

/* ---------------- Deleting ---------------- */
console.log("Eliminar");
r = await owner("DELETE", `/api/categories/${ropa.id}`);
check("no se elimina una categoría con subcategorías → 409", r.status === 409 && r.data.error.code === "has_subcategories", r.data);
r = await owner("DELETE", `/api/categories/${camisas.id}`);
check("eliminar una subcategoría", r.status === 204, r.data);
r = await owner("GET", `/api/products/${camisa.id}`);
check("sus productos quedan sin categoría", r.data.categoryId === null, r.data.categoryId);

/* ---------------- CSV import ---------------- */
console.log("Importación CSV");
r = await owner("POST", "/api/products/import", {
  products: [
    { name: "Taza", categoryName: "Hogar > Cocina", keywords: "regalo; cerámica", variants: [{ sku: `TZ-${stamp}`, priceCents: 18500 }], rows: [2] },
    { name: "Plato", categoryName: "hogar › cocina", variants: [{ sku: `PL-${stamp}`, priceCents: 9000 }], rows: [3] },
    { name: "Vaso", categoryName: "Bar > Vidrio", variants: [{ sku: `VA-${stamp}`, priceCents: 5000 }], rows: [4] },
    { name: "Shorts", categoryName: "Ropa > Pantalones", variants: [{ sku: `SH-${stamp}`, priceCents: 5000 }], rows: [5] },
  ],
});
check("importa con «Categoría > Subcategoría»", r.status === 200 && r.data.created === 4 && r.data.errors.length === 0, r.data);
const cats = (await owner("GET", "/api/categories")).data;
const cocina = cats.filter((c) => c.name.toLowerCase() === "cocina");
const bar = cats.find((c) => c.name === "Bar");
check("crea la subcategoría una sola vez dentro del padre existente", cocina.length === 1 && cocina[0].parentId === hogar.id && cocina[0].productCount === 2, cocina);
check("crea padre e hija nuevos", bar && cats.some((c) => c.name === "Vidrio" && c.parentId === bar.id), cats);
check("reutiliza la subcategoría existente", cats.find((c) => c.id === pantalones.id).productCount === 2, cats.find((c) => c.id === pantalones.id));
r = await owner("GET", "/api/products?q=ceramica");
check("las palabras clave importadas se buscan (sin acentos)", r.data.total === 1 && r.data.items[0].keywords.join() === "regalo,cerámica", r.data.items);

console.log(failures ? `\n${failures} fallo(s)` : "\nTodo bien");
process.exit(failures ? 1 : 0);
