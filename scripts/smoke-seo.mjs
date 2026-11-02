// End-to-end test of Phase 7 (legal pages, SEO/GEO/AEO data, traffic events) against a running API.
// Usage: node scripts/smoke-seo.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;
let seq = 0;

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

const owner = client(), shopper = client(), cashier = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Legal ${stamp}`, ownerName: "Lía Dueña", email: `lia-${stamp}@example.com`, password: "contrasena-segura-1" });
const slug = r.data.tenant.slug;
await owner("PUT", "/api/settings", { ...(await owner("GET", "/api/settings")).data, legalName: "Lía Comercial SA de CV", email: "hola@lia.mx", phone: "55 1111 2222", address: "Av. Juárez 10, CDMX" });
const main = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;
await owner("POST", "/api/users", { name: "Caro Cajera", email: `caro-${stamp}@example.com`, password: "contrasena-segura-1", role: "cashier" });
await cashier("POST", "/api/auth/login", { email: `caro-${stamp}@example.com`, password: "contrasena-segura-1" });

console.log("SEO de producto y tienda");
r = await owner("POST", "/api/products", { name: "Vela de soya", online: true, description: "Vela artesanal de cera de soya con aroma a lavanda.", seoTitle: "Vela de soya artesanal | Lía", seoDescription: "Hecha a mano en CDMX.", variants: [{ sku: `VS-${stamp}`, priceCents: 25000, initialStock: 5 }] });
const vela = r.data;
check("producto guarda título y descripción para buscadores", r.status === 201 && vela.seoTitle === "Vela de soya artesanal | Lía" && vela.seoDescription === "Hecha a mano en CDMX.", r.data);
r = await owner("POST", "/api/products", { name: "Larga", seoTitle: "x".repeat(71), variants: [{ priceCents: 100 }] });
check("título SEO de más de 70 caracteres → 422", r.status === 422, r.data);
const oculto = (await owner("POST", "/api/products", { name: "Interno", variants: [{ priceCents: 100 }] })).data;
r = await owner("GET", "/api/store-settings");
check("ajustes con SEO, FAQ e indexable por defecto", r.data.indexable === true && Array.isArray(r.data.faq) && r.data.seoTitle === null, r.data);
const base = { ...r.data };
for (const k of ["slug", "url", "publishedCount", "activeCount"]) delete base[k];
const faq = [{ q: "¿Hacen envíos?", a: "Sí, en toda la CDMX." }, { q: "¿Puedo recoger hoy?", a: "Sí, de 10 a 19 h." }];
r = await owner("PUT", "/api/store-settings", { ...base, enabled: true, locationId: main, seoTitle: "Velas artesanales en CDMX", seoDescription: "Velas de soya hechas a mano.", faq });
check("guardar SEO y preguntas frecuentes", r.status === 200 && r.data.seoTitle === "Velas artesanales en CDMX" && r.data.faq.length === 2, r.data);
r = await owner("PUT", "/api/store-settings", { ...base, enabled: true, locationId: main, faq: [{ q: "¿", a: "" }] });
check("pregunta incompleta → 422", r.status === 422, r.data);
r = await cashier("PUT", "/api/store-settings", { ...base, enabled: true, locationId: main });
check("el cajero no cambia la tienda → 403", r.status === 403, r.data);

console.log("Políticas");
r = await owner("GET", "/api/store-settings/policies");
check("tres páginas, ninguna creada", r.status === 200 && r.data.length === 3 && r.data.every((p) => p.content === null), r.data);
r = await owner("GET", "/api/store-settings/policies/privacy/template");
check("plantilla con los datos del negocio", r.status === 200 && r.data.content.includes("Lía Comercial SA de CV") && r.data.content.includes("hola@lia.mx") && r.data.content.includes("ARCO"), r.data);
const privacyText = r.data.content;
r = await owner("GET", "/api/store-settings/policies/otra/template");
check("tipo desconocido → 404", r.status === 404, r.data);
r = await cashier("PUT", "/api/store-settings/policies/privacy", { content: privacyText, published: true });
check("el cajero no publica políticas → 403", r.status === 403, r.data);
r = await owner("PUT", "/api/store-settings/policies/privacy", { content: "corto", published: true });
check("texto demasiado corto → 422", r.status === 422, r.data);
r = await owner("PUT", "/api/store-settings/policies/privacy", { content: privacyText, published: true });
check("publicar aviso de privacidad → versión 1", r.status === 200 && r.data.version === 1 && r.data.published, r.data);
r = await owner("PUT", "/api/store-settings/policies/privacy", { content: privacyText, published: true });
check("guardar sin cambios no crea versión", r.data.version === 1, r.data);
const terms = (await owner("GET", "/api/store-settings/policies/terms/template")).data.content;
r = await owner("PUT", "/api/store-settings/policies/terms", { content: terms, published: true });
check("publicar términos", r.data.version === 1, r.data);
r = await owner("PUT", "/api/store-settings/policies/returns", { content: (await owner("GET", "/api/store-settings/policies/returns/template")).data.content, published: false });
check("devoluciones como borrador", r.data.published === false, r.data);

r = await shopper("GET", `/api/store/${slug}`);
check("la tienda expone FAQ, SEO y políticas publicadas", r.status === 200 && r.data.faq.length === 2 && r.data.seoTitle === "Velas artesanales en CDMX" && r.data.indexable && r.data.domain === null
  && r.data.policies.length === 2 && r.data.policies.every((p) => p.version === 1), r.data);
r = await shopper("GET", `/api/store/${slug}/policies/terms`);
check("página pública de términos", r.status === 200 && r.data.content.includes("PROFECO"), r.data);
r = await shopper("GET", `/api/store/${slug}/policies/returns`);
check("un borrador no es público → 404", r.status === 404, r.data);
r = await shopper("GET", `/api/store/${slug}/products/${vela.id}`);
check("el producto público trae su SEO y fecha", r.data.seoTitle === "Vela de soya artesanal | Lía" && r.data.updatedAt, r.data);

console.log("Aceptación al comprar");
const order = (extra = {}) => ({
  clientId: `seo-${stamp}-${++seq}`, items: [{ variantId: vela.variants[0].id, quantity: 1 }], fulfillment: "pickup", customerName: "Iván Cliente",
  customerEmail: `ivan-${stamp}@example.com`, customerPhone: "5512345678", address: null, notes: null, paymentMethod: "on_delivery", expectedTotalCents: 25000, ...extra,
});
r = await shopper("POST", `/api/store/${slug}/orders`, order());
check("sin aceptar → 422 legal_required", r.status === 422 && r.data.error.code === "legal_required", r.data);
r = await owner("PUT", "/api/store-settings/policies/terms", { content: terms + "\n\n## Nuevo apartado\nTexto agregado.", published: true });
check("cambiar los términos → versión 2", r.data.version === 2, r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, order({ acceptLegal: true, legalVersions: { terms: 1, privacy: 1 } }));
check("aceptar una versión vieja → 409 legal_changed", r.status === 409 && r.data.error.code === "legal_changed", r.data);
r = await shopper("POST", `/api/store/${slug}/orders`, order({ acceptLegal: true, legalVersions: { terms: 2, privacy: 1 } }));
check("aceptar las versiones vigentes → pedido creado", r.status === 201, r.data);
const list = (await owner("GET", "/api/orders?status=all")).data.items;
r = await owner("GET", `/api/orders/${list[0].id}`);
check("el pedido guarda qué versiones aceptó y cuándo", r.data.legal && r.data.legal.termsVersion === 2 && r.data.legal.privacyVersion === 1 && r.data.legal.acceptedAt, r.data.legal);
r = await owner("GET", "/api/audit?entity=store_policy&limit=20");
check("cada publicación queda en la bitácora", r.data.items.filter((a) => a.action === "store.policy").length >= 4, r.data.items?.length);
await owner("PUT", "/api/store-settings/policies/terms", { content: terms, published: false });
await owner("PUT", "/api/store-settings/policies/privacy", { content: privacyText, published: false });
r = await shopper("POST", `/api/store/${slug}/orders`, order());
check("sin políticas publicadas no se pide aceptación", r.status === 201, r.data);
await owner("PUT", "/api/store-settings/policies/terms", { content: terms, published: true });

console.log("Mapa del sitio e índice");
r = await shopper("GET", `/api/store/${slug}/sitemap`);
check("datos del sitemap: solo productos publicados y políticas", r.status === 200 && r.data.indexable && r.data.products.length === 1 && r.data.products[0].id === vela.id && !r.data.products.some((p) => p.id === oculto.id) && r.data.policies.map((p) => p.kind).join() === "terms", r.data);
r = await shopper("GET", "/api/store-index");
check("índice general incluye la tienda", r.status === 200 && r.data.some((s) => s.slug === slug && s.domain === null && s.updatedAt), r.data?.length);
await owner("PUT", "/api/store-settings", { ...base, enabled: true, locationId: main, indexable: false, faq });
r = await shopper("GET", "/api/store-index");
check("una tienda no indexable sale del índice", !r.data.some((s) => s.slug === slug), r.data?.length);
await owner("PUT", "/api/store-settings", { ...base, enabled: true, locationId: main, faq });

console.log("Visitas");
r = await shopper("POST", `/api/store/${slug}/events`, { type: "page_view", path: `/${slug}`, referrer: "https://www.google.com/", utm: { source: "ig" } }, { "user-agent": "Mozilla/5.0 (iPhone)" });
check("evento de visita → 204 (sin cookies)", r.status === 204, r.data);
r = await shopper("POST", `/api/store/${slug}/events`, { type: "order_placed", path: "/" });
check("el navegador no puede inventar pedidos → 400/422", r.status === 400 || r.status === 422, r.data);
r = await shopper("POST", `/api/store/no-existe-${stamp.toLowerCase()}/events`, { type: "page_view", path: "/" });
check("tienda inexistente no falla", r.status === 204, r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
