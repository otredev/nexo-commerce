// End-to-end test of Phase 10 (online store analytics). It starts its OWN `wrangler dev` (port 8792,
// separate local state) pointed at a mock of the Cloudflare Analytics Engine SQL API that runs inside this
// script: it checks every query is scoped to the business and the dataset, and answers with known traffic.
// Sales come from real orders placed through the public store API.
// Usage: node scripts/smoke-analytics.mjs
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "api");
const PORT = 8792, AE_PORT = 12114;
const BASE = `http://127.0.0.1:${PORT}`;
const DATASET = "nexo_store_events_test";
const TOKEN = "cf_analytics_smoke";
const stamp = Date.now().toString(36).toUpperCase();
const TZ = "America/Mexico_City";
let failures = 0;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const localDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const shift = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/* ---------------- Mock Analytics Engine SQL API ---------------- */
const ae = { queries: [], fail: false, tenantId: null, products: {} };
const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
const aeServer = createServer((req, res) => {
  let sql = "";
  req.on("data", (c) => (sql += c));
  req.on("end", () => {
    ae.queries.push({ path: req.url, auth: req.headers.authorization, sql });
    if (req.url !== "/accounts/acct_smoke/analytics_engine/sql" || req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 403, { errors: [{ message: "forbidden" }] });
    if (ae.fail) return json(res, 500, { errors: [{ message: "boom" }] });
    if (!sql.endsWith(" FORMAT JSON") || !sql.includes(`FROM ${DATASET} WHERE index1 = '${ae.tenantId}' AND timestamp >= toDateTime(`)) return json(res, 400, { errors: [{ message: "unscoped query" }] });
    const end = Number(/timestamp < toDateTime\((\d+)\)/.exec(sql)?.[1]);
    const current = end * 1000 > Date.now();
    const rows = (data) => json(res, 200, { meta: [], data, rows: data.length });
    // Numbers come back as strings sometimes (UInt64): the API must cope.
    if (/^SELECT count\(DISTINCT blob7\) AS visitors FROM/.test(sql)) return rows([{ visitors: current ? "120" : "80" }]);
    if (sql.includes("GROUP BY type")) return rows([
      { type: "page_view", events: 300, visitors: 120 }, { type: "product_view", events: "150", visitors: 70 },
      { type: "add_to_cart", events: 40, visitors: 25 }, { type: "checkout_start", events: 20, visitors: 15 }, { type: "order_placed", events: 6, visitors: 6 },
    ]);
    if (sql.includes("GROUP BY day")) return rows([{ day: localDate(), views: "50", visitors: "30" }, { day: shift(localDate(), -1), views: 20, visitors: 12 }]);
    if (sql.includes("blob3 AS source")) return rows([{ source: "google.com", visitors: "40" }, { source: "l.instagram.com", visitors: 20 }]);
    if (sql.includes("blob8 AS source")) return rows([{ source: "instagram", medium: "social", campaign: "otono", visitors: 15 }]);
    if (sql.includes("blob5 AS device")) return rows([{ device: "mobile", visitors: 80 }, { device: "desktop", visitors: 35 }, { device: "", visitors: 1 }]);
    if (sql.includes("blob4 AS country")) return rows([{ country: "MX", visitors: 100 }, { country: "US", visitors: 10 }]);
    if (sql.includes("blob2 AS path")) return rows([{ path: "/tienda", views: 200, visitors: 100 }]);
    if (sql.includes("blob6 AS product")) return rows([
      { product: ae.products.sold, views: 90, carts: 20 }, { product: ae.products.viewedOnly, views: 30, carts: 2 }, { product: "no-existe", views: 5, carts: 0 },
    ]);
    return json(res, 400, { errors: [{ message: `unexpected query: ${sql}` }] });
  });
});

/* ---------------- Worker with its own state ---------------- */
try { await fetch(`${BASE}/api/health`); throw new Error(`Port ${PORT} is busy: stop the previous run first`); } catch (e) { if (String(e.message).startsWith("Port")) throw e; }
await new Promise((ok) => aeServer.listen(AE_PORT, "127.0.0.1", ok));
const state = mkdtempSync(join(tmpdir(), "nexo-analytics-"));
for (const db of ["DB_CONTROL", "DB_TENANT_DEFAULT"]) {
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", db, "--local", "--persist-to", state], { cwd: API_DIR, stdio: "ignore", env: { ...process.env, CI: "1" } });
}
const vars = { CF_ACCOUNT_ID: "acct_smoke", CF_ANALYTICS_TOKEN: TOKEN, STORE_EVENTS_DATASET: DATASET, CF_API_BASE: `http://127.0.0.1:${AE_PORT}` };
const worker = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", state, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { cwd: API_DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" }, detached: true });
let log = "";
worker.stdout.on("data", (d) => (log += d));
worker.stderr.on("data", (d) => (log += d));
let down = false;
const shutdown = () => {
  if (down) return;
  down = true;
  try { process.kill(-worker.pid, "SIGTERM"); } catch { /* already gone */ }
  aeServer.close();
  try { rmSync(state, { recursive: true, force: true }); } catch { /* ignore */ }
};
process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("uncaughtException", (e) => { console.error(e); shutdown(); process.exit(1); });
for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
  if (i > 120) { console.log(log.slice(-3000)); throw new Error("wrangler dev did not start"); }
  await sleep(500);
}

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const h = { ...(cookie ? { cookie } : {}) };
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

const pwd = "contrasena-segura-1";
const owner = client(), cashier = client(), shopper = client(), rival = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Dulcería ${stamp}`, ownerName: "Dana Dueña", email: `dana-${stamp}@example.com`, password: pwd });
const tenantId = r.data.tenant.id, slug = r.data.tenant.slug;
ae.tenantId = tenantId;
await owner("POST", "/api/users", { name: "Ciro Caja", email: `ciro-${stamp}@example.com`, password: pwd, role: "cashier" });
await cashier("POST", "/api/auth/login", { email: `ciro-${stamp}@example.com`, password: pwd });
await rival("POST", "/api/auth/register", { businessName: `Rival ${stamp}`, ownerName: "Rita", email: `rita-${stamp}@example.com`, password: pwd });
const main = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;
const settings = (await owner("GET", "/api/store-settings")).data;
for (const k of ["slug", "url", "publishedCount", "activeCount"]) delete settings[k];
await owner("PUT", "/api/store-settings", { ...settings, enabled: true, locationId: main, pickupEnabled: true, payOnDelivery: true, transferEnabled: true, transferInstructions: "CLABE 012345678901234567" });
const dulce = (await owner("POST", "/api/products", { name: "Cajeta", online: true, variants: [{ sku: `CJ-${stamp}`, priceCents: 10000, initialStock: 50 }] })).data;
const mazapan = (await owner("POST", "/api/products", { name: "Mazapán", online: true, variants: [{ sku: `MZ-${stamp}`, priceCents: 1500, initialStock: 50 }] })).data;
ae.products = { sold: dulce.id, viewedOnly: mazapan.id };

async function place(email, name, qty, paymentMethod = "on_delivery") {
  const body = { clientId: `an-${stamp}-${Math.random()}`, items: [{ variantId: dulce.variants[0].id, quantity: qty }], fulfillment: "pickup", customerName: name, customerEmail: email, customerPhone: "5512345678", address: null, notes: null, paymentMethod, expectedTotalCents: 0 };
  const first = await shopper("POST", `/api/store/${slug}/orders`, body);
  if (first.status !== 409 || first.data?.error?.code !== "price_changed") return first;
  return shopper("POST", `/api/store/${slug}/orders`, { ...body, expectedTotalCents: Number(first.data.error.fields.expectedTotalCents) });
}
const o1 = (await place(`ana-${stamp}@example.com`, "Ana", 1)).data;
const o2 = (await place(`ANA-${stamp}@example.com`, "Ana", 2, "transfer")).data;
const o3 = (await place(`beto-${stamp}@example.com`, "Beto", 3)).data;
const o4 = (await place(`beto-${stamp}@example.com`, "Beto", 1)).data;
const list = (await owner("GET", "/api/orders?status=all")).data.items;
const idOf = (n) => list.find((o) => o.number === n).id;
await owner("POST", `/api/orders/${idOf(o4.number)}/cancel`, { reason: "Cliente se arrepintió" });
// Ana's first order was 40 days ago: in the previous period of a 30-day report, and it makes her a returning customer.
const back = new Date(Date.now() - 40 * 86400_000).toISOString();
execFileSync("npx", ["wrangler", "d1", "execute", "DB_TENANT_DEFAULT", "--local", "--persist-to", state, "--command", `UPDATE orders SET created_at = '${back}' WHERE id = '${idOf(o1.number)}'`], { cwd: API_DIR, stdio: "ignore", env: { ...process.env, CI: "1" } });

const today = localDate();
const from = shift(today, -29);
console.log("Permisos y validación");
r = await cashier("GET", `/api/reports/store?from=${from}&to=${today}`);
check("el cajero no ve estadísticas → 403", r.status === 403, r.data);
r = await owner("GET", `/api/reports/store?from=${today}&to=${from}`);
check("periodo al revés → 400", r.status === 400, r.data);
r = await owner("GET", `/api/reports/store?from=${shift(today, -120)}&to=${today}`);
check("más de 90 días → 400", r.status === 400 && /90 días/.test(r.data.error.message), r.data);
r = await owner("GET", `/api/reports/store?from=ayer&to=${today}`);
check("fecha no válida → 400", r.status === 400, r.data);

console.log("Ventas (pedidos reales)");
ae.queries = [];
r = await owner("GET", `/api/reports/store?from=${from}&to=${today}`);
const a = r.data;
check("200 con el periodo anterior del mismo largo", r.status === 200 && a.previousTo === shift(from, -1) && a.previousFrom === shift(from, -30), { status: r.status, prev: [a?.previousFrom, a?.previousTo] });
check("3 pedidos en el periodo, 1 cancelado", a.sales.orders === 3 && a.sales.cancelled === 1, a.sales);
check("ventas sin cancelados y ticket promedio", a.sales.salesCents === 50000 && a.sales.avgOrderCents === 25000, a.sales);
check("periodo anterior: 1 pedido de $100", a.sales.previousOrders === 1 && a.sales.previousSalesCents === 10000, a.sales);
check("clientes: 2, uno ya había comprado (sin importar mayúsculas)", a.sales.customers === 2 && a.sales.returningCustomers === 1, a.sales);
check("por forma de pago", a.sales.byPayment.find((p) => p.method === "transfer")?.salesCents === 20000 && a.sales.byPayment.find((p) => p.method === "on_delivery")?.orders === 1, a.sales.byPayment);
check("por estado (incluye el cancelado)", a.sales.byStatus.find((x) => x.status === "cancelled")?.orders === 1 && a.sales.byStatus.find((x) => x.status === "pending")?.orders === 2, a.sales.byStatus);
check("ventas de hoy en la serie diaria, un día por fecha", a.days.length === 30 && a.days.at(-1).date === today && a.days.at(-1).orders === 2 && a.days.at(-1).salesCents === 50000, a.days.at(-1));
const cajeta = a.products.find((p) => p.productId === dulce.id);
check("producto vendido: piezas, pedidos y ventas (sin el cancelado)", cajeta?.quantity === 5 && cajeta.orders === 2 && cajeta.salesCents === 50000, cajeta);

console.log("Visitas (Analytics Engine)");
check("visitantes y comparación", a.traffic.available && a.traffic.visitors === 120 && a.traffic.previousVisitors === 80, a.traffic);
check("vistas de páginas y productos", a.traffic.pageViews === 300 && a.traffic.productViews === 150, a.traffic);
check("embudo por visitantes únicos", JSON.stringify(a.traffic.funnel) === JSON.stringify({ visitors: 120, viewedProduct: 70, addedToCart: 25, startedCheckout: 15, ordered: 6 }), a.traffic.funnel);
check("conversión = pedidos no cancelados / visitantes", Math.abs(a.conversionPct - (2 / 120) * 100) < 1e-9 && Math.abs(a.previousConversionPct - (1 / 80) * 100) < 1e-9, [a.conversionPct, a.previousConversionPct]);
check("fuentes, con «directo» = el resto de visitantes", JSON.stringify(a.traffic.sources) === JSON.stringify([{ source: "", visitors: 60 }, { source: "google.com", visitors: 40 }, { source: "l.instagram.com", visitors: 20 }]), a.traffic.sources);
check("campañas UTM", a.traffic.campaigns[0]?.campaign === "otono" && a.traffic.campaigns[0].visitors === 15, a.traffic.campaigns);
check("dispositivos (descarta valores desconocidos)", a.traffic.devices.map((d) => d.device).join() === "mobile,desktop", a.traffic.devices);
check("países y páginas", a.traffic.countries[0]?.country === "MX" && a.traffic.pages[0]?.views === 200, [a.traffic.countries, a.traffic.pages]);
check("visitas por día (números como texto)", a.days.at(-1).visitors === 30 && a.days.at(-1).views === 50 && a.days.at(-2).visitors === 12 && a.days.at(-3).visitors === 0, a.days.slice(-3));
check("producto vendido trae sus vistas y carritos", cajeta?.views === 90 && cajeta.addToCart === 20, cajeta);
const maz = a.products.find((p) => p.productId === mazapan.id);
check("producto solo visto aparece con su nombre y 0 ventas", maz?.name === "Mazapán" && maz.views === 30 && maz.salesCents === 0, maz);
check("ids que no son productos del negocio no aparecen", !a.products.some((p) => p.productId === "no-existe"), a.products.map((p) => p.productId));
check("cada consulta va limitada al negocio, al dataset y al periodo (10 consultas)", ae.queries.length === 10 && ae.queries.every((q) => q.sql.includes(`index1 = '${tenantId}'`) && q.sql.includes(`FROM ${DATASET}`)), ae.queries.length);
check("con el token y la cuenta de la plataforma", ae.queries.every((q) => q.auth === `Bearer ${TOKEN}` && q.path === "/accounts/acct_smoke/analytics_engine/sql"), ae.queries[0]);
check("los días se agrupan en la zona horaria del negocio", ae.queries.some((q) => q.sql.includes(`formatDateTime(timestamp, '%Y-%m-%d', '${TZ}')`)), null);
check("las cuentas usan el muestreo (_sample_interval)", ae.queries.filter((q) => q.sql.includes("SUM(_sample_interval)") || q.sql.includes("sumIf(_sample_interval")).length >= 4, null);

console.log("Si Analytics Engine falla");
ae.fail = true;
r = await owner("GET", `/api/reports/store?from=${from}&to=${today}`);
check("las ventas siguen y las visitas avisan error", r.status === 200 && r.data.traffic.available === false && r.data.traffic.reason === "error" && r.data.sales.orders === 3 && r.data.conversionPct === null && r.data.days.at(-1).visitors === null, r.data.traffic);
check("los productos quedan sin vistas (null)", r.data.products.every((p) => p.views === null), r.data.products);
ae.fail = false;

console.log("Aislamiento");
ae.tenantId = (await rival("GET", "/api/me")).data.tenant.id;
r = await rival("GET", `/api/reports/store?from=${from}&to=${today}`);
check("otro negocio no ve estos pedidos", r.status === 200 && r.data.sales.orders === 0 && r.data.products.every((p) => p.productId !== dulce.id), r.data.sales);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
shutdown();
process.exit(failures ? 1 : 0);
