// End-to-end test of Phase 8 (daily operation): Web Push notifications and the paired customer display.
// It starts its OWN `wrangler dev` (port 8791, separate local state) with throwaway VAPID keys, and a mock
// push service inside this script that DECRYPTS each message like a browser would (RFC 8291) and checks
// the VAPID signature (RFC 8292). No real keys, and the dev databases are not touched.
// Usage: node scripts/smoke-ops.mjs
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "api");
const PORT = 8791, PUSH_PORT = 12113;
const BASE = `http://127.0.0.1:${PORT}`;
const PUSH = `http://127.0.0.1:${PUSH_PORT}`;
const stamp = Date.now().toString(36).toUpperCase();
const subtle = globalThis.crypto.subtle;
let failures = 0;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* ---------------- base64url + crypto helpers ---------------- */
const b64u = {
  encode: (b) => Buffer.from(b).toString("base64url"),
  decode: (s) => new Uint8Array(Buffer.from(s, "base64url")),
};
const concat = (...p) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const enc = new TextEncoder();
const hmac = async (k, d) => new Uint8Array(await subtle.sign("HMAC", await subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
const hkdf = async (salt, ikm, info, n) => (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, n);

/* VAPID keys of the "platform" for this run. */
const vapidPair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const VAPID_PUBLIC = b64u.encode(new Uint8Array(await subtle.exportKey("raw", vapidPair.publicKey)));
const VAPID_PRIVATE = (await subtle.exportKey("jwk", vapidPair.privateKey)).d;

/* ---------------- Mock push service (what FCM / Mozilla / Apple do) ---------------- */
const devices = new Map(); // id → { privateKey, publicRaw, auth, gone }
const inbox = []; // { device, headers, message?, vapidOk, error? }

async function newDevice(name, { gone = false } = {}) {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  devices.set(name, { privateKey: pair.privateKey, publicRaw, auth, gone });
  return { endpoint: `${PUSH}/push/${name}`, keys: { p256dh: b64u.encode(publicRaw), auth: b64u.encode(auth) } };
}

async function decrypt(dev, body) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const secret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []) }, dev.privateKey, 256));
  const ikm = await hkdf(dev.auth, secret, concat(enc.encode("WebPush: info\0"), dev.publicRaw, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  if (plain[plain.length - 1] !== 2 || rs !== 4096) throw new Error("bad record");
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

async function verifyVapid(header) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header ?? "");
  if (!m || m[2] !== VAPID_PUBLIC) return false;
  const [h, c, s] = m[1].split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  if (claims.aud !== PUSH || !String(claims.sub).startsWith("mailto:") || claims.exp < Date.now() / 1000 || claims.exp > Date.now() / 1000 + 86400) return false;
  return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapidPair.publicKey, b64u.decode(s), enc.encode(`${h}.${c}`));
}

const pushServer = createServer((req, res) => {
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", async () => {
    const name = req.url.split("/").pop();
    const dev = devices.get(name);
    const entry = { device: name, headers: req.headers, vapidOk: await verifyVapid(req.headers.authorization) };
    try {
      if (dev) entry.message = await decrypt(dev, new Uint8Array(Buffer.concat(chunks)));
    } catch (e) { entry.error = String(e); }
    inbox.push(entry);
    res.writeHead(!dev ? 404 : dev.gone ? 410 : 201);
    res.end();
  });
});
const received = (device, from = 0) => inbox.slice(from).filter((m) => m.device === device);
async function waitFor(pred, ms = 6000) {
  for (let t = 0; t < ms; t += 100) { if (pred()) return true; await sleep(100); }
  return pred();
}

/* ---------------- Worker with its own state ---------------- */
try { await fetch(`${BASE}/api/health`); throw new Error(`Port ${PORT} is busy: stop the previous run first`); } catch (e) { if (String(e.message).startsWith("Port")) throw e; }
await new Promise((ok) => pushServer.listen(PUSH_PORT, "127.0.0.1", ok));
const state = mkdtempSync(join(tmpdir(), "nexo-ops-"));
for (const db of ["DB_CONTROL", "DB_TENANT_DEFAULT"]) {
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", db, "--local", "--persist-to", state], { cwd: API_DIR, stdio: "ignore", env: { ...process.env, CI: "1" } });
}
const vars = { VAPID_PUBLIC_KEY: VAPID_PUBLIC, VAPID_PRIVATE_KEY: VAPID_PRIVATE, VAPID_SUBJECT: "mailto:soporte@nexo.test" };
const worker = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", state, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { cwd: API_DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" }, detached: true });
let log = "";
worker.stdout.on("data", (d) => (log += d));
worker.stderr.on("data", (d) => (log += d));
let down = false;
const shutdown = () => {
  if (down) return;
  down = true;
  try { process.kill(-worker.pid, "SIGTERM"); } catch { /* already gone */ }
  pushServer.close();
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

function client(ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36") {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const h = { "user-agent": ua, ...headers, ...(cookie ? { cookie } : {}) };
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
const owner = client();
const cashier = client("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
const rival = client(), shopper = client(), anon = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Abarrotes ${stamp}`, ownerName: "Olga Dueña", email: `olga-${stamp}@example.com`, password: pwd });
const tenantId = r.data.tenant.id, slug = r.data.tenant.slug;
await owner("POST", "/api/users", { name: "Carla Caja", email: `carla-${stamp}@example.com`, password: pwd, role: "cashier" });
await cashier("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: pwd });
await rival("POST", "/api/auth/register", { businessName: `Rival ${stamp}`, ownerName: "Rita", email: `rita-${stamp}@example.com`, password: pwd });

/* ---------------- Settings ---------------- */
console.log("Preferencias y dispositivos");
r = await owner("GET", "/api/notifications");
check("disponible con la llave pública de la plataforma", r.status === 200 && r.data.available && r.data.publicKey === VAPID_PUBLIC && r.data.devices.length === 0, r.data);
check("el propietario ve los 4 avisos, activados por defecto", r.data.events.map((e) => e.id).join() === "order_new,order_paid,daily_digest,billing" && r.data.events.every((e) => e.enabled), r.data.events);
r = await cashier("GET", "/api/notifications");
check("el cajero no ve avisos de la suscripción", r.status === 200 && !r.data.events.some((e) => e.id === "billing") && r.data.events.some((e) => e.id === "order_new"), r.data.events);
r = await anon("GET", "/api/notifications");
check("sin sesión → 401", r.status === 401, r.data);

r = await owner("POST", "/api/notifications/subscriptions", { endpoint: "no-es-url", keys: { p256dh: "x", auth: "y" } });
check("suscripción inválida → 422", r.status === 422, r.data);
const ownerPc = await newDevice("owner-pc");
const ownerOld = await newDevice("owner-old", { gone: true });
const cashierPhone = await newDevice("cashier-phone");
r = await owner("POST", "/api/notifications/subscriptions", ownerPc);
check("registrar este navegador → 201 con nombre del dispositivo", r.status === 201 && r.data.device === "Windows · Chrome", r.data);
const ownerPcId = r.data.id;
r = await owner("POST", "/api/notifications/subscriptions", ownerPc);
check("registrar de nuevo el mismo navegador no lo duplica", r.status === 201 && r.data.id === ownerPcId, r.data);
await owner("POST", "/api/notifications/subscriptions", ownerOld);
r = await cashier("POST", "/api/notifications/subscriptions", cashierPhone);
check("el cajero registra su iPhone", r.status === 201 && r.data.device === "iPhone · Safari", r.data);
const cashierPhoneId = r.data.id;
r = await owner("GET", "/api/notifications");
check("el propietario ve solo sus 2 dispositivos", r.data.devices.length === 2, r.data.devices);

/* ---------------- Test push ---------------- */
console.log("Notificación de prueba");
let mark = inbox.length;
r = await owner("POST", "/api/notifications/test");
check("enviar prueba → llega a 1 dispositivo vigente", r.status === 200 && r.data.sent === 1, r.data);
const pcMsg = received("owner-pc", mark)[0];
check("el servicio de push recibe el mensaje cifrado y lo descifra", pcMsg?.message?.title === "Notificaciones activadas" && pcMsg.message.url === "/configuracion?tab=notificaciones", pcMsg);
check("con firma VAPID válida y cabeceras correctas", pcMsg?.vapidOk === true && pcMsg.headers["content-encoding"] === "aes128gcm" && Number(pcMsg.headers.ttl) > 0 && pcMsg.headers.urgency === "normal", pcMsg?.headers);
check("la prueba no llega al cajero", received("cashier-phone", mark).length === 0, received("cashier-phone", mark));
r = await owner("GET", "/api/notifications");
check("el dispositivo que ya no existe (410) se borra solo", r.data.devices.length === 1 && r.data.devices[0].id === ownerPcId && r.data.devices[0].lastSentAt, r.data.devices);

/* ---------------- Online orders ---------------- */
console.log("Pedidos de la tienda");
const product = (await owner("POST", "/api/products", { name: "Café de olla", online: true, variants: [{ sku: `CAF-${stamp}`, priceCents: 12000, initialStock: 20 }] })).data;
const main = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;
const settings = (await owner("GET", "/api/store-settings")).data;
for (const k of ["slug", "url", "publishedCount", "activeCount"]) delete settings[k];
r = await owner("PUT", "/api/store-settings", { ...settings, enabled: true, locationId: main, pickupEnabled: true, payOnDelivery: true, holdHours: 48, accountRequired: false });
check("tienda activa", r.status === 200 && r.data.enabled, r.data);
async function place() {
  const body = { clientId: `ops-${stamp}-${Math.random()}`, items: [{ variantId: product.variants[0].id, quantity: 1 }], fulfillment: "pickup", customerName: "Pepe Cliente", customerEmail: `pepe-${stamp}@example.com`, customerPhone: "5512345678", address: null, notes: null, paymentMethod: "on_delivery", expectedTotalCents: 12000 };
  const first = await shopper("POST", `/api/store/${slug}/orders`, body);
  if (first.status !== 409 || first.data?.error?.code !== "price_changed") return first;
  return shopper("POST", `/api/store/${slug}/orders`, { ...body, expectedTotalCents: Number(first.data.error.fields.expectedTotalCents) });
}

r = await owner("PUT", "/api/notifications/prefs", { prefs: { order_new: false, inventado: true } });
check("guardar preferencias ignora avisos desconocidos", r.status === 200 && r.data.prefs.order_new === false && !("inventado" in r.data.prefs), r.data);
r = await owner("GET", "/api/notifications");
check("la preferencia se refleja en la configuración", r.data.events.find((e) => e.id === "order_new").enabled === false, r.data.events);
mark = inbox.length;
r = await place();
check("pedido en la tienda → 201", r.status === 201, r.data);
const number1 = r.data.number;
await waitFor(() => received("cashier-phone", mark).length > 0);
const cashierMsg = received("cashier-phone", mark)[0]?.message;
check("al cajero le llega «Pedido nuevo» con cliente, total y enlace", cashierMsg?.title === `Pedido nuevo #${String(number1).padStart(6, "0")}` && /Pepe Cliente · .*120.* · recoge en tienda/.test(cashierMsg.body) && cashierMsg.url.startsWith("/pedidos/"), cashierMsg);
check("con urgencia alta", received("cashier-phone", mark)[0]?.headers.urgency === "high", received("cashier-phone", mark)[0]?.headers);
await sleep(300);
check("al propietario no (lo desactivó)", received("owner-pc", mark).length === 0, received("owner-pc", mark));

await owner("PUT", "/api/notifications/prefs", { prefs: { order_new: true } });
mark = inbox.length;
r = await place();
await waitFor(() => received("owner-pc", mark).length > 0 && received("cashier-phone", mark).length > 0);
check("al reactivarlo, llega a ambos", received("owner-pc", mark).length === 1 && received("cashier-phone", mark).length === 1, inbox.slice(mark).map((m) => m.device));
check("cada aviso lleva el número de ese pedido", inbox.slice(mark).every((m) => m.message?.title?.includes(String(r.data.number))), inbox.slice(mark).map((m) => m.message));

/* ---------------- Morning digest ---------------- */
console.log("Resumen de la mañana");
await owner("POST", "/api/products", { name: "Azúcar", variants: [{ sku: `AZU-${stamp}`, priceCents: 3000, initialStock: 0 }] });
await owner("POST", "/api/products", { name: "Sal", variants: [{ sku: `SAL-${stamp}`, priceCents: 1500, initialStock: 0 }] });
mark = inbox.length;
r = await anon("POST", `/api/dev/digest?tenantId=${tenantId}`);
check("se envía el resumen", r.status === 200 && r.data.sent === 2, r.data);
const digest = received("owner-pc", mark)[0]?.message;
check("dice cuántos productos resurtir y lleva al inventario", digest?.title === "Resumen de hoy" && digest.body === "2 productos necesitan resurtirse" && digest.url === "/inventario?stock=low" && /^digest-\d{4}-\d{2}-\d{2}$/.test(digest.tag), digest);
check("Topic para reemplazar el resumen anterior", /^digest-\d{4}-\d{2}-\d{2}$/.test(received("owner-pc", mark)[0]?.headers.topic ?? ""), received("owner-pc", mark)[0]?.headers);
r = await cashier("PUT", "/api/notifications/prefs", { prefs: { daily_digest: false } });
mark = inbox.length;
r = await anon("POST", `/api/dev/digest?tenantId=${tenantId}`);
check("el cajero puede desactivar el resumen", r.data.sent === 1 && received("cashier-phone", mark).length === 0, r.data);
r = await anon("POST", `/api/dev/digest?tenantId=${(await rival("GET", "/api/me")).data.tenant.id}`);
check("negocio sin dispositivos → no envía nada", r.data.sent === 0, r.data);

/* ---------------- Removing devices ---------------- */
console.log("Quitar dispositivos");
r = await owner("DELETE", `/api/notifications/subscriptions/${cashierPhoneId}`);
r = await cashier("GET", "/api/notifications");
check("nadie puede quitar el dispositivo de otra persona", r.data.devices.length === 1, r.data.devices);
r = await cashier("POST", "/api/notifications/subscriptions/remove", { endpoint: cashierPhone.endpoint });
check("el navegador se da de baja por su endpoint → 204", r.status === 204, r.data);
r = await owner("DELETE", `/api/notifications/subscriptions/${ownerPcId}`);
check("quitar un dispositivo → 204", r.status === 204, r.data);
r = await owner("POST", "/api/notifications/test");
check("sin dispositivos la prueba avisa → 409 no_devices", r.status === 409 && r.data.error.code === "no_devices", r.data);

/* ---------------- Customer display ---------------- */
console.log("Pantalla del cliente emparejada");
r = await anon("POST", "/api/pos/display");
check("generar código sin sesión → 401", r.status === 401, r.data);
r = await cashier("POST", "/api/pos/display");
const code = r.data?.code;
check("el cajero genera un código de 6 dígitos", r.status === 201 && /^\d{6}$/.test(code), r.data);
r = await anon("GET", `/api/display/${code}`);
check("la pantalla valida el código sin iniciar sesión (aún sin venta)", r.status === 200 && r.data === null, r.data);
r = await anon("GET", "/api/display/12345");
check("código mal formado → 404", r.status === 404, r.data);
r = await anon("GET", `/api/display/${code === "000000" ? "000001" : "000000"}`);
check("código que no existe → 404", r.status === 404, r.data);

const frames = [];
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/display/${code}/ws`);
let closeCode = null;
ws.onmessage = (e) => frames.push(e.data);
ws.onclose = (e) => { closeCode = e.code; };
await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
check("la pantalla se conecta por WebSocket", ws.readyState === 1);
await sleep(300);
check("sin venta en curso no recibe nada todavía", frames.length === 0, frames);

const sale = {
  v: 1, business: { name: `Abarrotes ${stamp}`, logoKey: null }, currency: "MXN", locale: "es-MX", phase: "cart",
  lines: [{ key: "a", name: "Café de olla", detail: "", quantity: "2", totalCents: 24000, savingCents: 0 }],
  itemsCount: 2, subtotalCents: 20690, discountCents: 0, taxCents: 3310, totalCents: 24000, pricesIncludeTax: true, paidCents: 0, changeCents: 0, customerName: null, saleNumber: null, at: Date.now(),
};
r = await cashier("POST", `/api/pos/display/${code}/state`, { state: sale });
check("la caja publica la venta → 1 pantalla conectada", r.status === 200 && r.data.displays === 1, r.data);
await waitFor(() => frames.length > 0, 2000);
check("la pantalla la recibe al instante", JSON.parse(frames[0] ?? "null")?.totalCents === 24000, frames);
const late = [];
const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}/api/display/${code}/ws`);
ws2.onmessage = (e) => late.push(e.data);
await waitFor(() => late.length > 0, 2000);
check("una segunda pantalla recibe la venta en curso al conectarse", JSON.parse(late[0] ?? "null")?.lines?.length === 1, late);
ws2.close();
ws.send("ping");
await waitFor(() => frames.includes("pong"), 2000);
check("responde al ping (mantener viva la conexión)", frames.includes("pong"), frames);
r = await anon("GET", `/api/display/${code}`);
check("una pantalla que entra tarde obtiene la venta en curso", r.status === 200 && r.data.lines[0].name === "Café de olla", r.data);
r = await rival("POST", `/api/pos/display/${code}/state`, { state: { ...sale, totalCents: 1 } });
check("otro negocio no puede escribir en el código → 404 display_gone", r.status === 404 && r.data.error.code === "display_gone", r.data);
r = await cashier("POST", `/api/pos/display/${code}/state`, { state: { ...sale, lines: Array.from({ length: 700 }, (_, i) => ({ ...sale.lines[0], key: String(i), name: "x".repeat(80) })) } });
check("una venta enorme → 413", r.status === 413, r.data);
await rival("DELETE", `/api/pos/display/${code}`);
r = await anon("GET", `/api/display/${code}`);
check("otro negocio no puede terminar el emparejamiento", r.status === 200, r.data);
r = await cashier("DELETE", `/api/pos/display/${code}`);
check("terminar el emparejamiento → 204", r.status === 204, r.data);
await waitFor(() => closeCode !== null, 3000);
check("la pantalla se desconecta con el código 4000 (olvida el código)", closeCode === 4000, closeCode);
r = await anon("GET", `/api/display/${code}`);
check("el código deja de existir", r.status === 404, r.data);
r = await cashier("POST", `/api/pos/display/${code}/state`, { state: sale });
check("la caja se entera de que terminó → display_gone", r.status === 404 && r.data.error.code === "display_gone", r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
shutdown();
process.exit(failures ? 1 : 0);
