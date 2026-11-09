// End-to-end test of the store appearance (theme, announcement, home page sections, live preview, CSS)
// against a running API, plus the store's Pages middleware when it is running too (wrangler pages dev on
// :8788; skipped otherwise).
// Usage: node scripts/smoke-theme.mjs [apiBase] [storeBase]
const BASE = process.argv[2] ?? "http://localhost:8787";
const STORE = process.argv[3] ?? "http://localhost:8788";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;

function client() {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const h = { ...headers, ...(cookie ? { cookie } : {}) };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
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
const iso = (d) => d.toISOString().slice(0, 10);
const day = (offset) => iso(new Date(Date.now() + offset * 86400_000));
const fieldsOf = (r) => Object.keys(r.data?.error?.fields ?? {});

// 1×1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
async function upload(who) {
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "banner.png");
  return (await who("POST", "/api/uploads", fd)).data.key;
}

const pwd = "contrasena-segura-1";
const owner = client(), cashier = client(), rival = client(), shopper = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Moda ${stamp}`, ownerName: "Mara Dueña", email: `mara-${stamp}@example.com`, password: pwd });
const slug = r.data.tenant.slug;
await owner("POST", "/api/users", { name: "Ciro Caja", email: `ciro-${stamp}@example.com`, password: pwd, role: "cashier" });
await cashier("POST", "/api/auth/login", { email: `ciro-${stamp}@example.com`, password: pwd });
await rival("POST", "/api/auth/register", { businessName: `Rival ${stamp}`, ownerName: "Rita", email: `rita-${stamp}@example.com`, password: pwd });
const main = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;
const base = (await owner("GET", "/api/store-settings")).data;
for (const k of ["slug", "url", "publishedCount", "activeCount"]) delete base[k];
await owner("PUT", "/api/store-settings", { ...base, enabled: true, locationId: main });
await owner("POST", "/api/products", { name: "Blusa", online: true, variants: [{ sku: `BL-${stamp}`, priceCents: 45000, initialStock: 4 }] });

console.log("Valores por defecto");
r = await owner("GET", "/api/store-settings/appearance");
const initial = r.data;
check("tema Nexo, sin avisos, píxeles ni CSS", r.status === 200 && initial.theme.preset === "nexo" && !initial.announcement.enabled && !initial.pixels.metaPixelId && initial.updatedAt === null, r.data);
check("la página principal de siempre: portada, catálogo y preguntas", initial.blocks.map((b) => `${b.type}:${b.id}`).join() === "hero:portada,catalog:catalogo,faq:preguntas", initial.blocks);
check("cada sección trae todos sus campos", initial.blocks[0].style.paddingTop === "md" && initial.blocks[0].data.showHeading === true && initial.blocks[1].data.columns === 4, initial.blocks[0]);
check("el código es solo CSS (sin HTML/JS ni plan)", JSON.stringify(initial.code) === '{"css":""}' && !("codeAllowed" in initial) && !("banners" in initial), initial.code);
r = await shopper("GET", `/api/store/${slug}`);
check("la tienda pública trae las secciones por defecto y su zona horaria", r.status === 200 && r.data.appearance.blocks.length === 3 && r.data.appearance.announcement === null && typeof r.data.timezone === "string" && !("previewOrigin" in r.data), r.data.appearance);

const appearance = () => ({
  theme: { preset: "boutique", primary: "#7A3E4D", background: null, text: null, font: "geometrica", radius: null },
  announcement: { enabled: true, messages: [{ text: "Envío gratis desde $599", link: "?categoria=x" }, { text: "Nueva colección", link: "/p/abc" }], tone: "ink", dismissible: true, startsOn: null, endsOn: null },
  blocks: [],
  pixels: { metaPixelId: "123456789012345", googleTagId: "g-abc1234xyz", tiktokPixelId: null },
  code: { css: ".st-card__name{text-transform:uppercase}</style><script>alert(1)</script>" },
});

console.log("Guardar");
r = await cashier("PUT", "/api/store-settings/appearance", appearance());
check("el cajero no puede cambiar la apariencia → 403", r.status === 403, r.data);
r = await cashier("GET", "/api/store-settings/appearance");
check("el cajero sí puede verla", r.status === 200, r.data);
const img = await upload(owner);
const rivalImg = await upload(rival);
const slide = (extra = {}) => ({ id: "b1", enabled: true, image: img, imageMobile: null, heading: "Otoño", text: "Hasta 30% menos", cta: "Ver", link: "?categoria=otono", textColor: "light", align: "left", startsOn: null, endsOn: null, ...extra });
const banners = (slides) => ({ id: "promos", type: "banners", data: { slides } });
const put = (extra) => owner("PUT", "/api/store-settings/appearance", { ...appearance(), ...extra });

r = await put({ theme: { ...appearance().theme, primary: "rojo" } });
check("color no válido → 422 en theme.primary", r.status === 422 && r.data.error.fields["theme.primary"], r.data);
r = await put({ theme: { ...appearance().theme, preset: "inventado" } });
check("estilo desconocido → 422", r.status === 422 && r.data.error.fields["theme.preset"], r.data);
r = await put({ announcement: { ...appearance().announcement, messages: [{ text: "Hola", link: "javascript:alert(1)" }] } });
check("enlace javascript: → 422", r.status === 422 && r.data.error.fields["announcement.messages.0.link"], r.data);
r = await put({ announcement: { ...appearance().announcement, messages: [{ text: "", link: null }] } });
check("barra activa sin mensaje → 422", r.status === 422 && r.data.error.fields["announcement.messages"], r.data);
r = await put({ announcement: { ...appearance().announcement, startsOn: day(5), endsOn: day(1) } });
check("fechas al revés → 422", r.status === 422 && r.data.error.fields["announcement.endsOn"], r.data);
r = await put({ blocks: [banners([slide({ link: "//evil.example" })])] });
check("banner con enlace de protocolo relativo (//) → 422", r.status === 422 && r.data.error.fields["blocks.0.data.slides.0.link"], r.data);
r = await put({ blocks: [banners([slide({ link: null })])] });
check("botón de banner sin enlace → 422", r.status === 422 && r.data.error.fields["blocks.0.data.slides.0.link"], r.data);
r = await put({ blocks: [banners([slide({ image: rivalImg })])] });
check("imagen de otro negocio → 422", r.status === 422 && r.data.error.fields["blocks.0.data.slides.0.image"], r.data);
r = await put({ blocks: [{ id: "g", type: "gallery", style: { backgroundImage: rivalImg } }] });
check("imagen de fondo de otro negocio → 422", r.status === 422 && r.data.error.fields["blocks.0.style.backgroundImage"], r.data);
r = await put({ blocks: [banners(Array.from({ length: 9 }, (_, i) => slide({ id: `b${i}` })))] });
check("más de 8 imágenes en un banner → 422", r.status === 422 && r.data.error.fields["blocks.0.data.slides"], r.data);
r = await put({ blocks: [{ id: "a", type: "catalog" }, { id: "b", type: "catalog" }] });
check("dos catálogos → 422", r.status === 422 && fieldsOf(r).some((k) => k.startsWith("blocks.1")), r.data);
r = await put({ blocks: [{ id: "a", type: "text" }, { id: "a", type: "text" }] });
check("secciones repetidas → 422", r.status === 422 && fieldsOf(r).some((k) => k.startsWith("blocks.1")), r.data);
r = await put({ blocks: [{ id: "x", type: "carrusel3d" }] });
check("tipo de sección desconocido → 422", r.status === 422 && fieldsOf(r).some((k) => k.startsWith("blocks.0")), r.data);
r = await put({ blocks: [{ id: "h", type: "hero", data: { buttons: [{ label: "Ir", link: "javascript:alert(1)" }] } }] });
check("botón con javascript: → 422", r.status === 422 && r.data.error.fields["blocks.0.data.buttons.0.link"], r.data);
r = await put({ blocks: [{ id: "v", type: "embed", data: { url: "http://youtube.com/watch?v=dQw4w9WgXcQ" } }] });
check("embebido sin https → 422", r.status === 422 && r.data.error.fields["blocks.0.data.url"], r.data);
r = await put({ blocks: [{ id: "t", type: "text", style: { background: "red;}body{display:none" } }] });
check("color de sección no válido → 422", r.status === 422 && r.data.error.fields["blocks.0.style.background"], r.data);
r = await put({ blocks: Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, type: "html", data: { html: "<p>x</p>" } })) });
check("más de 10 secciones HTML → 422", r.status === 422, r.data);
r = await put({ pixels: { metaPixelId: "abc", googleTagId: "UA-123", tiktokPixelId: null } });
check("IDs de píxel no válidos → 422", r.status === 422 && r.data.error.fields["pixels.metaPixelId"] && r.data.error.fields["pixels.googleTagId"], r.data);
r = await put({ code: { css: "x".repeat(50_001) } });
check("CSS de más de 50 000 caracteres → 422", r.status === 422 && r.data.error.fields["code.css"], r.data);
r = await put({ code: { css: "a{}", headHtml: "<meta>", bodyHtml: "<div>", js: "x()" } });
check("HTML/JS en el código se ignoran (solo queda el CSS)", r.status === 200 && JSON.stringify(r.data.code) === '{"css":"a{}"}', r.data.code);

const full = {
  ...appearance(),
  blocks: [
    { id: "menu", type: "header", data: { links: [{ label: "Horarios", link: "#horarios" }, { label: "Llámanos", link: "tel:+52 55 1234 5678" }], layout: "centered" }, style: { background: "#101820" } },
    banners([slide(), slide({ id: "b2", heading: "Futuro", startsOn: day(10) }), slide({ id: "b3", heading: "Oculto", enabled: false }), slide({ id: "b4", heading: "Pasado", endsOn: day(-3) })]),
    { id: "portada", type: "hero", data: { heading: "Moda que dura", buttons: [{ label: "Ver todo", link: "#productos" }] }, style: { background: "#FBEFF2", edgeBottom: "wave", width: "full" } },
    { id: "catalogo", type: "catalog", data: { columns: 3, defaultSort: "new" } },
    { id: "nosotros", type: "text", enabled: false, data: { body: "Oculta" } },
    { id: "luego", type: "text", startsOn: day(10), data: { body: "Futura" } },
    { id: "fotos", type: "gallery", data: { images: [{ image: img, caption: "Taller" }] }, device: "mobile" },
    { id: "horas", type: "hours", anchor: "horarios" },
    { id: "video", type: "embed", data: { url: "https://youtu.be/dQw4w9WgXcQ" } },
    { id: "widget", type: "html", data: { html: "<div id='x-own'>Hola</div><script>window.__nxTest=1</script>", forms: true } },
    { id: "linea", type: "divider", data: { kind: "zigzag" } },
  ],
};
r = await owner("PUT", "/api/store-settings/appearance", full);
check("guardar todo (HTML personalizado incluido, en plan Gratis) → 200", r.status === 200 && r.data.updatedAt, r.data);
const savedFull = r.data;
check("normaliza colores e IDs", r.data.theme.primary === "#7a3e4d" && r.data.pixels.googleTagId === "G-ABC1234XYZ" && r.data.blocks[2].style.background === "#fbeff2", { theme: r.data.theme, pixels: r.data.pixels });
check("guarda las 11 secciones en orden, con sus valores por defecto", r.data.blocks.map((b) => b.id).join() === full.blocks.map((b) => b.id).join() && r.data.blocks[7].data.days.length === 7 && r.data.blocks[9].data.popups === false, r.data.blocks.map((b) => b.id));
r = await owner("GET", "/api/audit?entity=store_appearance");
const audit = (r.data.items ?? r.data).find?.((a) => a.action === "store.appearance");
check("queda en la actividad", Boolean(audit), r.data);

console.log("Tienda pública");
r = await shopper("GET", `/api/store/${slug}`);
const pub = r.data.appearance;
check("trae tema y píxeles", pub.theme.preset === "boutique" && pub.theme.font === "geometrica" && pub.pixels.metaPixelId === "123456789012345", pub);
check("barra de avisos activa con id para recordar «cerrar»", pub.announcement?.messages.length === 2 && pub.announcement.tone === "ink" && typeof pub.announcement.id === "string", pub.announcement);
check("solo las secciones visibles y vigentes", pub.blocks.map((b) => b.id).join() === "menu,promos,portada,catalogo,fotos,horas,video,widget,linea", pub.blocks.map((b) => b.id));
check("del banner, solo la imagen vigente (ni futura, ni oculta, ni vencida)", pub.blocks[1].data.slides.map((s) => s.id).join() === "b1", pub.blocks[1].data.slides);
check("el HTML personalizado viaja como dato (se dibuja en un marco aislado)", pub.blocks[7].type === "html" && pub.blocks[7].data.html.includes("x-own"), pub.blocks[7]);
check("el CSS no viaja en los datos de la tienda", !("code" in pub) && !JSON.stringify(r.data).includes("text-transform"), Object.keys(pub));
r = await shopper("GET", `/api/store/${slug}/custom-code`);
check("el CSS se sirve aparte para el servidor de la tienda, y nada más", r.status === 200 && r.data.css.includes("text-transform") && Object.keys(r.data).join() === "css", r.data);

r = await owner("PUT", "/api/store-settings/appearance", { ...full, announcement: { ...full.announcement, endsOn: day(-2) } });
r = await shopper("GET", `/api/store/${slug}`);
check("aviso vencido ya no se muestra", r.data.appearance.announcement === null, r.data.appearance.announcement);
r = await owner("PUT", "/api/store-settings/appearance", { ...full, announcement: { ...full.announcement, messages: [{ text: "Otro texto", link: null }] } });
r = await shopper("GET", `/api/store/${slug}`);
check("cambiar el texto cambia el id (vuelve a aparecer a quien la cerró)", r.data.appearance.announcement.id !== pub.announcement.id, r.data.appearance.announcement);

console.log("Vista previa en vivo");
r = await owner("POST", "/api/store-settings/appearance/preview");
const token = r.data.token;
check("da un token que vence", r.status === 200 && /^nxp_/.test(token) && new Date(r.data.expiresAt) > new Date(), r.data);
r = await rival("POST", "/api/store-settings/appearance/preview");
const rivalToken = r.data.token;
r = await cashier("POST", "/api/store-settings/appearance/preview");
check("el cajero también puede ver la vista previa", r.status === 200, r.data);
const s2 = (await owner("GET", "/api/store-settings")).data;
for (const k of ["slug", "url", "publishedCount", "activeCount"]) delete s2[k];
await owner("PUT", "/api/store-settings", { ...s2, enabled: false });
r = await shopper("GET", `/api/store/${slug}`);
check("tienda apagada → 404 para el público", r.status === 404, r.data);
r = await shopper("GET", `/api/store/${slug}`, undefined, { "x-nexo-preview": token });
check("con el token, la vista previa la ve aunque esté apagada", r.status === 200 && typeof r.data.previewOrigin === "string" && r.data.appearance.blocks.length > 0, r.data);
check("y la respuesta no se guarda en cachés", r.headers.get("cache-control") === "private, no-store" && (r.headers.get("vary") ?? "").toLowerCase().includes("x-nexo-preview"), Object.fromEntries(r.headers));
r = await shopper("GET", `/api/store/${slug}/products`, undefined, { "x-nexo-preview": token });
check("también el catálogo", r.status === 200 && r.data.total >= 1, r.data);
r = await shopper("POST", `/api/store/${slug}/coupons/check`, { code: "X" }, { "x-nexo-preview": token });
check("pero nada que escriba (solo GET)", r.status === 404, r.data);
r = await shopper("GET", `/api/store/${slug}`, undefined, { "x-nexo-preview": rivalToken });
check("el token de otro negocio no sirve", r.status === 404, r.data);
r = await shopper("GET", `/api/store/${slug}`, undefined, { "x-nexo-preview": "nxp_inventado_inventado_inventado" });
check("un token inventado no sirve", r.status === 404, r.data);
await owner("PUT", "/api/store-settings", { ...s2, enabled: true });
r = await shopper("GET", `/api/store/${slug}`);
check("las respuestas públicas siguen en caché corta y avisan que varían con la vista previa", r.status === 200 && r.headers.get("cache-control") === "public, max-age=30" && (r.headers.get("vary") ?? "").toLowerCase().includes("x-nexo-preview"), Object.fromEntries(r.headers));

/* ---------- Pages middleware (optional) ---------- */
let storeUp = false;
try { storeUp = (await fetch(`${STORE}/robots.txt`)).ok; } catch { /* not running */ }
if (!storeUp) console.log(`\n(La tienda no está en ${STORE}: se omiten las pruebas del servidor de la tienda)`);
else {
  console.log("Servidor de la tienda (Pages)");
  r = await owner("PUT", "/api/store-settings/appearance", { ...full, theme: { preset: "nocturno", primary: null, background: null, text: null, font: null, radius: null }, code: { css: ".st-hero{outline:1px solid red}</style><script>alert(1)</script>" } });
  const res = await fetch(`${STORE}/${slug}`);
  const html = await res.text();
  check("inyecta el tema en <head> (sin parpadeo)", html.includes('<style id="nx-theme">:root:root:root{color-scheme:dark;') && html.includes("--bg:#111214"), html.slice(0, 400));
  check("y ajusta color-scheme", /<meta name="color-scheme" content="dark"/.test(html), html.match(/<meta name="color-scheme"[^>]*>/)?.[0]);
  check("inyecta el CSS propio sin poder cerrar la etiqueta <style>", html.includes('<style id="nx-custom-css">.st-hero{outline:1px solid red}<\\/style><script>alert(1)</script></style>'), html.match(/<style id="nx-custom-css">[\s\S]{0,120}/)?.[0]);
  check("nunca inyecta en la página el HTML ni el JavaScript de las secciones", !html.includes("x-own") && !html.includes("__nxTest"), null);
  check("y prohíbe service workers en el origen compartido", res.headers.get("content-security-policy") === "worker-src 'none'", res.headers.get("content-security-policy"));
}
void savedFull;

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
