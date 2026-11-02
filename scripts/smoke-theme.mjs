// End-to-end test of Phase 9 (store appearance) against a running API, plus the store's Pages middleware
// when it is running too (wrangler pages dev on :8788; skipped otherwise).
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
    return { status: res.status, data };
  };
}
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}
const iso = (d) => d.toISOString().slice(0, 10);
const day = (offset) => iso(new Date(Date.now() + offset * 86400_000));

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
check("tema Nexo, sin avisos, banners, píxeles ni código", r.status === 200 && initial.theme.preset === "nexo" && !initial.announcement.enabled && initial.banners.length === 0 && !initial.pixels.metaPixelId && initial.code.css === "" && initial.updatedAt === null, r.data);
check("el plan Gratis no permite HTML/JS propio", initial.codeAllowed === false && initial.domain === null, r.data);
r = await shopper("GET", `/api/store/${slug}`);
check("la tienda pública trae la apariencia por defecto", r.status === 200 && r.data.appearance.theme.preset === "nexo" && r.data.appearance.announcement === null && r.data.appearance.banners.length === 0, r.data.appearance);

const appearance = () => ({
  theme: { preset: "boutique", primary: "#7A3E4D", background: null, text: null, font: "geometrica", radius: null },
  announcement: { enabled: true, messages: [{ text: "Envío gratis desde $599", link: "?categoria=x" }, { text: "Nueva colección", link: "/p/abc" }], tone: "ink", dismissible: true, startsOn: null, endsOn: null },
  banners: [],
  pixels: { metaPixelId: "123456789012345", googleTagId: "g-abc1234xyz", tiktokPixelId: null },
  code: { css: ".st-card__name{text-transform:uppercase}</style><script>alert(1)</script>", headHtml: "", bodyHtml: "", js: "" },
});

console.log("Guardar");
r = await cashier("PUT", "/api/store-settings/appearance", appearance());
check("el cajero no puede cambiar la apariencia → 403", r.status === 403, r.data);
r = await cashier("GET", "/api/store-settings/appearance");
check("el cajero sí puede verla", r.status === 200, r.data);
const img = await upload(owner);
const rivalImg = await upload(rival);
const banner = (extra = {}) => ({ id: "b1", enabled: true, image: img, imageMobile: null, heading: "Otoño", text: "Hasta 30% menos", cta: "Ver", link: "?categoria=otono", textColor: "light", align: "left", startsOn: null, endsOn: null, ...extra });

r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), theme: { ...appearance().theme, primary: "rojo" } });
check("color no válido → 422 en theme.primary", r.status === 422 && r.data.error.fields["theme.primary"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), theme: { ...appearance().theme, preset: "inventado" } });
check("estilo desconocido → 422", r.status === 422 && r.data.error.fields["theme.preset"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), announcement: { ...appearance().announcement, messages: [{ text: "Hola", link: "javascript:alert(1)" }] } });
check("enlace javascript: → 422", r.status === 422 && r.data.error.fields["announcement.messages.0.link"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), announcement: { ...appearance().announcement, messages: [{ text: "", link: null }] } });
check("barra activa sin mensaje → 422", r.status === 422 && r.data.error.fields["announcement.messages"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), announcement: { ...appearance().announcement, startsOn: day(5), endsOn: day(1) } });
check("fechas al revés → 422", r.status === 422 && r.data.error.fields["announcement.endsOn"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), banners: [banner({ link: "//evil.example" })] });
check("enlace de protocolo relativo (//) → 422", r.status === 422 && r.data.error.fields["banners.0.link"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), banners: [banner({ link: null })] });
check("botón sin enlace → 422", r.status === 422 && r.data.error.fields["banners.0.link"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), banners: [banner({ image: rivalImg })] });
check("imagen de otro negocio → 422", r.status === 422 && r.data.error.fields["banners.0.image"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), banners: Array.from({ length: 7 }, (_, i) => banner({ id: `b${i}` })) });
check("más de 6 banners → 422", r.status === 422 && r.data.error.fields.banners, r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), pixels: { metaPixelId: "abc", googleTagId: "UA-123", tiktokPixelId: null } });
check("IDs de píxel no válidos → 422", r.status === 422 && r.data.error.fields["pixels.metaPixelId"] && r.data.error.fields["pixels.googleTagId"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), code: { ...appearance().code, css: "x".repeat(50_001) } });
check("CSS de más de 50 000 caracteres → 422", r.status === 422 && r.data.error.fields["code.css"], r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...appearance(), code: { ...appearance().code, js: "console.log(1)" } });
check("JavaScript en plan Gratis → 402 plan_feature", r.status === 402 && r.data.error.code === "plan_feature", r.data);

const full = {
  ...appearance(),
  banners: [
    banner(),
    banner({ id: "b2", heading: "Futuro", startsOn: day(10) }),
    banner({ id: "b3", heading: "Oculto", enabled: false }),
    banner({ id: "b4", heading: "Pasado", endsOn: day(-3) }),
  ],
};
r = await owner("PUT", "/api/store-settings/appearance", full);
check("guardar todo → 200", r.status === 200 && r.data.updatedAt, r.data);
check("normaliza colores e IDs", r.data.theme.primary === "#7a3e4d" && r.data.pixels.googleTagId === "G-ABC1234XYZ", { theme: r.data.theme, pixels: r.data.pixels });
check("guarda los 4 banners en orden", r.data.banners.map((b) => b.id).join() === "b1,b2,b3,b4", r.data.banners);
r = await owner("GET", "/api/audit?entity=store_appearance");
const audit = (r.data.items ?? r.data).find?.((a) => a.action === "store.appearance");
check("queda en la actividad", Boolean(audit), r.data);

console.log("Tienda pública");
r = await shopper("GET", `/api/store/${slug}`);
const pub = r.data.appearance;
check("trae tema y píxeles", pub.theme.preset === "boutique" && pub.theme.font === "geometrica" && pub.pixels.metaPixelId === "123456789012345", pub);
check("barra de avisos activa con id para recordar «cerrar»", pub.announcement?.messages.length === 2 && pub.announcement.tone === "ink" && typeof pub.announcement.id === "string", pub.announcement);
check("solo el banner vigente (ni futuro, ni oculto, ni vencido)", pub.banners.map((b) => b.id).join() === "b1" && !("startsOn" in pub.banners[0]) && !("enabled" in pub.banners[0]), pub.banners);
check("el código no viaja en los datos de la tienda", !("code" in pub) && !JSON.stringify(r.data).includes("text-transform"), Object.keys(pub));
r = await shopper("GET", `/api/store/${slug}/custom-code`);
check("el CSS se sirve aparte para el servidor de la tienda", r.status === 200 && r.data.css.includes("text-transform") && r.data.js === "", r.data);

r = await owner("PUT", "/api/store-settings/appearance", { ...full, announcement: { ...full.announcement, endsOn: day(-2) } });
r = await shopper("GET", `/api/store/${slug}`);
check("aviso vencido ya no se muestra", r.data.appearance.announcement === null, r.data.appearance.announcement);
r = await owner("PUT", "/api/store-settings/appearance", { ...full, announcement: { ...full.announcement, messages: [{ text: "Otro texto", link: null }] } });
r = await shopper("GET", `/api/store/${slug}`);
check("cambiar el texto cambia el id (vuelve a aparecer a quien la cerró)", r.data.appearance.announcement.id !== pub.announcement.id, r.data.appearance.announcement);

console.log("Plan Pro: HTML y JavaScript");
await owner("POST", "/api/dev/plan", { plan: "pro" });
r = await owner("GET", "/api/store-settings/appearance");
check("Pro permite código (falta dominio propio)", r.data.codeAllowed === true && r.data.domain === null, r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...full, code: { ...full.code, headHtml: '<meta name="x-test" content="1">', bodyHtml: "<div id='chat'></div>", js: "window.__nxTest = 1; // </script>" } });
check("Pro guarda HTML y JavaScript", r.status === 200 && r.data.code.js.includes("__nxTest"), r.data);
await owner("POST", "/api/dev/plan", { plan: "free" });
r = await owner("PUT", "/api/store-settings/appearance", { ...r.data, theme: { ...r.data.theme, preset: "minimal" }, codeAllowed: undefined, domain: undefined, updatedAt: undefined });
check("al bajar de plan puede seguir editando lo demás sin borrar su código", r.status === 200 && r.data.theme.preset === "minimal" && r.data.code.js.includes("__nxTest"), r.data);
r = await owner("PUT", "/api/store-settings/appearance", { ...r.data, code: { ...r.data.code, js: "window.__otro = 2" }, codeAllowed: undefined, domain: undefined, updatedAt: undefined });
check("pero no cambiar el JavaScript → 402", r.status === 402, r.data);
await owner("POST", "/api/dev/plan", { plan: "pro" });

/* ---------- Pages middleware (optional) ---------- */
let storeUp = false;
try { storeUp = (await fetch(`${STORE}/robots.txt`)).ok; } catch { /* not running */ }
if (!storeUp) console.log(`\n(La tienda no está en ${STORE}: se omiten las pruebas del servidor de la tienda)`);
else {
  console.log("Servidor de la tienda (Pages)");
  r = await owner("PUT", "/api/store-settings/appearance", { ...full, theme: { preset: "nocturno", primary: null, background: null, text: null, font: null, radius: null }, code: { css: ".st-hero{outline:1px solid red}</style><script>alert(1)</script>", headHtml: "<meta name='x-own' content='1'>", bodyHtml: "<div id='x-own'></div>", js: "window.__nxTest=1" } });
  const res = await fetch(`${STORE}/${slug}`);
  const html = await res.text();
  check("inyecta el tema en <head> (sin parpadeo)", html.includes('<style id="nx-theme">:root:root:root{color-scheme:dark;') && html.includes("--bg:#111214"), html.slice(0, 400));
  check("y ajusta color-scheme", /<meta name="color-scheme" content="dark"/.test(html), html.match(/<meta name="color-scheme"[^>]*>/)?.[0]);
  check("inyecta el CSS propio sin poder cerrar la etiqueta <style>", html.includes('<style id="nx-custom-css">.st-hero{outline:1px solid red}<\\/style><script>alert(1)</script></style>'), html.match(/<style id="nx-custom-css">[\s\S]{0,120}/)?.[0]);
  check("en el dominio compartido NO inyecta HTML ni JavaScript propios", !html.includes("x-own") && !html.includes("__nxTest"), null);
  check("y prohíbe service workers en el origen compartido", res.headers.get("content-security-policy") === "worker-src 'none'", res.headers.get("content-security-policy"));
}

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
