// End-to-end test of Phase 11 (API keys, outgoing webhooks and the MCP server) against a running API in
// development (http webhook URLs are allowed only there). A webhook receiver runs inside this script and
// verifies each signature.
// Usage: node scripts/smoke-integrations.mjs [baseUrl]
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const BASE = process.argv[2] ?? "http://localhost:8787";
const HOOK_PORT = 12115;
const HOOK = `http://127.0.0.1:${HOOK_PORT}/hook`;
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}

/* ---------------- Webhook receiver ---------------- */
const hook = { received: [], status: 200, secret: null };
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sig = req.headers["nexo-signature"] ?? "";
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
    let valid = false;
    if (m && hook.secret) {
      const expected = createHmac("sha256", hook.secret).update(`${m[1]}.${body}`).digest();
      valid = timingSafeEqual(expected, Buffer.from(m[2], "hex")) && Math.abs(Date.now() / 1000 - Number(m[1])) < 300;
    }
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* keep null */ }
    hook.received.push({ headers: req.headers, payload, valid });
    res.writeHead(hook.status, { "content-type": "text/plain" });
    res.end(hook.status === 200 ? "ok" : "fallo de prueba");
  });
});
await new Promise((ok) => server.listen(HOOK_PORT, "127.0.0.1", ok));
const got = (type, from = 0) => hook.received.slice(from).filter((h) => h.payload?.type === type);
async function waitFor(pred, ms = 5000) {
  for (let t = 0; t < ms; t += 100) { if (pred()) return true; await sleep(100); }
  return pred();
}

function client(bearer) {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const h = { ...headers, ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
    let payload;
    if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

const pwd = "contrasena-segura-1";
const owner = client(), cashier = client(), rival = client(), shopper = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Ferre ${stamp}`, ownerName: "Fede Dueño", email: `fede-${stamp}@example.com`, password: pwd });
const tenantId = r.data.tenant.id, slug = r.data.tenant.slug;
await owner("POST", "/api/users", { name: "Ciro Caja", email: `ciro-${stamp}@example.com`, password: pwd, role: "cashier" });
await cashier("POST", "/api/auth/login", { email: `ciro-${stamp}@example.com`, password: pwd });
await rival("POST", "/api/auth/register", { businessName: `Rival ${stamp}`, ownerName: "Rita", email: `rita-${stamp}@example.com`, password: pwd });
await rival("POST", "/api/products", { name: `Secreto ${stamp}`, variants: [{ priceCents: 100 }] });
const main = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;

/* ---------------- API keys ---------------- */
console.log("Llaves de API");
r = await cashier("GET", "/api/integrations");
check("el cajero no ve integraciones → 403", r.status === 403, r.data);
r = await owner("GET", "/api/integrations");
check("vacío, con límites del plan y direcciones", r.status === 200 && r.data.apiKeys.length === 0 && r.data.limits.apiKeys === 2 && r.data.mcpUrl.endsWith("/mcp"), r.data);
r = await owner("POST", "/api/integrations/api-keys", { name: "", access: "read" });
check("sin nombre → 422", r.status === 422, r.data);
r = await owner("POST", "/api/integrations/api-keys", { name: "Claude (lectura)", access: "read" });
const readKey = r.data.key;
check("crear llave → 201, la llave completa solo esta vez", r.status === 201 && /^nx_[A-Za-z0-9_-]{43}$/.test(readKey) && r.data.apiKey.prefix === readKey.slice(0, 10) && r.data.apiKey.access === "read", r.data);
r = await owner("POST", "/api/integrations/api-keys", { name: "Inventario externo", access: "full", expiresInDays: 30 });
const fullKey = r.data.key, fullId = r.data.apiKey.id;
check("con vencimiento", r.status === 201 && r.data.apiKey.expiresAt > new Date().toISOString(), r.data.apiKey);
r = await owner("POST", "/api/integrations/api-keys", { name: "Una más", access: "pos" });
check("plan Gratis: máximo 2 llaves → 402", r.status === 402 && r.data.error.code === "plan_limit", r.data);
r = await owner("GET", "/api/integrations");
check("la lista nunca trae la llave ni su hash", r.data.apiKeys.length === 2 && !JSON.stringify(r.data).includes(readKey) && !("hash" in r.data.apiKeys[0]), r.data.apiKeys);

const reader = client(readKey), writer = client(fullKey), nobody = client(`nx_${"x".repeat(43)}`), bad = client("abc");
r = await reader("GET", "/api/products");
check("la llave lee productos de su negocio (y no los de otro)", r.status === 200 && !JSON.stringify(r.data).includes(`Secreto ${stamp}`), r.status);
r = await reader("POST", "/api/products", { name: "No", variants: [{ priceCents: 100 }] });
check("llave de solo lectura no escribe → 403", r.status === 403 && r.data.error.code === "read_only_key", r.data);
r = await nobody("GET", "/api/products");
check("llave desconocida → 401", r.status === 401 && r.data.error.code === "invalid_api_key", r.data);
r = await bad("GET", "/api/products");
check("Authorization mal formado → 401", r.status === 401, r.data);
for (const p of ["/api/users", "/api/integrations", "/api/billing", "/api/notifications"]) {
  r = await writer("GET", p);
  check(`una llave no entra a ${p} → 403`, r.status === 403 && r.data.error.code === "forbidden_for_api_key", r.data);
}

/* ---------------- Webhooks ---------------- */
console.log("Webhooks");
r = await owner("POST", "/api/integrations/webhooks", { url: "ftp://x.com/hook", events: [] });
check("dirección no válida → 422", r.status === 422 && r.data.error.fields.url, r.data);
r = await owner("POST", "/api/integrations/webhooks", { url: HOOK, description: "Mi ERP", events: ["product.created", "order.created", "order.status_changed"] });
const ep = r.data;
hook.secret = ep.secret;
check("crear webhook → 201 con secreto whsec_", r.status === 201 && /^whsec_/.test(ep.secret) && ep.events.length === 3 && ep.active, r.data);
r = await owner("POST", "/api/integrations/webhooks", { url: `${HOOK}2`, events: [] });
check("plan Gratis: 1 webhook → 402", r.status === 402, r.data);

let mark = hook.received.length;
r = await writer("POST", "/api/products", { name: `Martillo ${stamp}`, online: true, variants: [{ sku: `MAR-${stamp}`, priceCents: 15000, initialStock: 10 }] });
const martillo = r.data;
check("la llave de escritura crea un producto", r.status === 201, r.data);
await waitFor(() => got("product.created", mark).length > 0);
const pc = got("product.created", mark)[0];
check("llega product.created firmado", pc?.valid === true && pc.payload.data.id === martillo.id && pc.payload.business.slug === slug, pc && { valid: pc.valid, payload: pc.payload?.type });
check("con cabeceras Nexo-Event y Nexo-Delivery", pc?.headers["nexo-event"] === "product.created" && /^whd_/.test(pc.headers["nexo-delivery"] ?? ""), pc?.headers);
r = await owner("GET", "/api/audit?entity=product");
const audit = (r.data.items ?? r.data).find?.((a) => a.entityId === martillo.id);
check("la actividad dice que lo hizo la llave", audit?.userName === "API · Inventario externo", audit);

mark = hook.received.length;
await owner("POST", "/api/inventory/movements", { variantId: martillo.variants[0].id, locationId: main, type: "in", quantity: 5, unitCostCents: null, reason: "purchase", note: null });
await sleep(800);
check("eventos no suscritos no se envían (stock.changed)", got("stock.changed", mark).length === 0, hook.received.slice(mark).map((h) => h.payload?.type));

mark = hook.received.length;
r = await owner("POST", `/api/integrations/webhooks/${ep.id}/test`);
check("probar envía un ping y devuelve la entrega", r.status === 200 && r.data.status === "succeeded" && r.data.lastStatus === 200 && got("ping", mark)[0]?.valid, r.data);

// Store order → order.created
const settings = (await owner("GET", "/api/store-settings")).data;
for (const k of ["slug", "url", "publishedCount", "activeCount"]) delete settings[k];
await owner("PUT", "/api/store-settings", { ...settings, enabled: true, locationId: main, pickupEnabled: true, payOnDelivery: true });
const orderBody = { clientId: `int-${stamp}`, items: [{ variantId: martillo.variants[0].id, quantity: 2 }], fulfillment: "pickup", customerName: "Olga Cliente", customerEmail: `olga-${stamp}@example.com`, customerPhone: "5512345678", address: null, notes: null, paymentMethod: "on_delivery", expectedTotalCents: 0 };
mark = hook.received.length;
r = await shopper("POST", `/api/store/${slug}/orders`, orderBody);
if (r.status === 409 && r.data.error.code === "price_changed") r = await shopper("POST", `/api/store/${slug}/orders`, { ...orderBody, expectedTotalCents: Number(r.data.error.fields.expectedTotalCents) });
const orderNumber = r.data.number;
await waitFor(() => got("order.created", mark).length > 0);
const oc = got("order.created", mark)[0];
check("pedido de la tienda → order.created con productos y cliente", oc?.valid && oc.payload.data.number === orderNumber && oc.payload.data.items[0].quantity === 2 && oc.payload.data.customer.email === `olga-${stamp}@example.com`.toLowerCase(), oc?.payload?.data);
const orderId = oc?.payload.data.id;

/* ---------------- Retries ---------------- */
console.log("Reintentos");
hook.status = 500;
await owner("PUT", `/api/integrations/webhooks/${ep.id}`, { url: HOOK, description: "Mi ERP", events: [], active: true });
mark = hook.received.length;
await owner("PUT", `/api/products/${martillo.id}`, { ...martillo, name: `Martillo pro ${stamp}`, variants: martillo.variants.map((v) => ({ ...v, initialStock: undefined })) });
await waitFor(() => got("product.updated", mark).length > 0);
r = await owner("GET", `/api/integrations/webhooks/${ep.id}/deliveries`);
const failed = r.data.find((d) => d.type === "product.updated");
check("si el receptor falla, queda pendiente con reintento", failed?.status === "pending" && failed.attempts === 1 && failed.lastStatus === 500 && failed.nextAttemptAt > new Date().toISOString(), failed);
r = await owner("GET", "/api/integrations");
check("el webhook cuenta las fallas seguidas", r.data.webhooks[0].failures >= 1, r.data.webhooks[0]);
r = await owner("POST", `/api/dev/webhooks-retry`);
check("antes de tiempo no reintenta", r.data.retried === 0 || !(await owner("GET", `/api/integrations/webhooks/${ep.id}/deliveries`)).data.find((d) => d.id === failed.id && d.attempts > 1), r.data);
hook.status = 200;
mark = hook.received.length;
r = await owner("POST", `/api/dev/webhooks-retry?at=${encodeURIComponent(new Date(Date.now() + 2 * 60_000).toISOString())}`);
check("el trabajo de cada hora reintenta lo vencido", r.data.retried >= 1, r.data);
r = await owner("GET", `/api/integrations/webhooks/${ep.id}/deliveries`);
const retried = r.data.find((d) => d.id === failed.id);
check("y al responder 2xx queda entregado", retried?.status === "succeeded" && retried.attempts === 2 && got("product.updated", mark).length === 1, retried);
r = await owner("GET", "/api/integrations");
check("un éxito pone las fallas en 0", r.data.webhooks[0].failures === 0 && r.data.webhooks[0].lastSuccessAt, r.data.webhooks[0]);
r = await owner("GET", `/api/integrations/webhooks/deliveries/${failed.id}`);
check("se puede ver qué se envió", r.status === 200 && r.data.payload.type === "product.updated" && r.data.payload.data.name === `Martillo pro ${stamp}`, r.data);
mark = hook.received.length;
r = await owner("POST", `/api/integrations/webhooks/deliveries/${failed.id}/resend`);
check("reenviar a mano", r.status === 200 && r.data.status === "succeeded" && got("product.updated", mark).length === 1, r.data);
r = await rival("GET", `/api/integrations/webhooks/deliveries/${failed.id}`);
check("otro negocio no ve esa entrega → 404", r.status === 404, r.data);

r = await owner("POST", `/api/integrations/webhooks/${ep.id}/rotate-secret`);
const oldSecret = hook.secret;
hook.secret = r.data.secret;
check("rotar el secreto", r.status === 200 && r.data.secret !== oldSecret, r.data);
mark = hook.received.length;
await owner("POST", `/api/integrations/webhooks/${ep.id}/test`);
check("las firmas usan el secreto nuevo", got("ping", mark)[0]?.valid === true, got("ping", mark)[0]?.valid);

/* ---------------- MCP ---------------- */
console.log("Servidor MCP");
const rpc = async (key, body, headers = {}) => {
  const res = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};
r = await rpc(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
check("sin llave → 401 con WWW-Authenticate", r.status === 401 && /Bearer/.test(r.headers.get("www-authenticate") ?? ""), r.data);
r = await rpc(readKey, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
check("initialize → versión, servidor e instrucciones", r.status === 200 && r.data.result.protocolVersion === "2025-06-18" && r.data.result.serverInfo.name === "nexo" && r.data.result.capabilities.tools && r.data.result.instructions.includes(`Ferre ${stamp}`), r.data);
r = await rpc(readKey, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
check("versión desconocida → ofrece la más reciente", r.data.result.protocolVersion === "2025-06-18", r.data.result);
r = await rpc(readKey, { jsonrpc: "2.0", method: "notifications/initialized" });
check("notificación → 202 sin cuerpo", r.status === 202 && !r.data, r);
r = await rpc(readKey, { jsonrpc: "2.0", id: 2, method: "tools/list" });
const readTools = r.data.result.tools.map((t) => t.name);
check("llave de lectura: sin herramientas que cambian datos", readTools.includes("buscar_productos") && readTools.includes("reporte_de_ventas") && !readTools.includes("avanzar_pedido") && !readTools.includes("ajustar_existencias"), readTools);
check("cada herramienta trae esquema y anotaciones", r.data.result.tools.every((t) => t.inputSchema?.type === "object" && t.annotations?.readOnlyHint === true), r.data.result.tools[0]);
r = await rpc(fullKey, { jsonrpc: "2.0", id: 3, method: "tools/list" });
check("llave completa: también las de escritura", r.data.result.tools.some((t) => t.name === "avanzar_pedido" && t.annotations.readOnlyHint === false), r.data.result.tools.map((t) => t.name));
r = await rpc(readKey, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "buscar_productos", arguments: { texto: "Martillo" } } });
check("buscar_productos devuelve el producto", r.data.result.isError === false && r.data.result.content[0].text.includes(`Martillo pro ${stamp}`), r.data);
const today = new Date().toISOString().slice(0, 10);
r = await rpc(readKey, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "reporte_de_ventas", arguments: { desde: today, hasta: today } } });
check("reporte_de_ventas", r.data.result.isError === false && JSON.parse(r.data.result.content[0].text).totals, r.data.result);
r = await rpc(readKey, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ver_producto", arguments: { id: "no-existe" } } });
check("un error de la API llega como isError con el mensaje", r.data.result.isError === true && /404/.test(r.data.result.content[0].text), r.data.result);
r = await rpc(readKey, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ver_producto", arguments: {} } });
check("falta un dato obligatorio → isError", r.data.result.isError === true && r.data.result.content[0].text.includes("id"), r.data.result);
r = await rpc(readKey, { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "avanzar_pedido", arguments: { id: orderId, accion: "aceptar" } } });
check("herramienta de escritura con llave de lectura → error JSON-RPC", r.data.error?.code === -32602, r.data);
mark = hook.received.length;
r = await rpc(fullKey, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "avanzar_pedido", arguments: { id: orderId, accion: "aceptar" } } });
check("avanzar_pedido acepta el pedido", r.data.result.isError === false && JSON.parse(r.data.result.content[0].text).status === "confirmed", r.data.result);
await waitFor(() => got("order.status_changed", mark).length > 0);
check("y el webhook avisa el cambio de estado", got("order.status_changed", mark)[0]?.payload.data.status === "confirmed", got("order.status_changed", mark)[0]?.payload?.data?.status);
r = await rpc(readKey, { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "listar_pedidos", arguments: { estado: "aceptados" } } });
check("listar_pedidos con filtro en español", r.data.result.isError === false && JSON.parse(r.data.result.content[0].text).items.some((o) => o.number === orderNumber), r.data.result);
r = await rpc(readKey, [{ jsonrpc: "2.0", id: 11, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 12, method: "inventado" }]);
check("lote: responde solo las peticiones con id", Array.isArray(r.data) && r.data.length === 2 && r.data[0].result && r.data[1].error.code === -32601, r.data);
r = await rpc(readKey, "{no es json");
check("JSON inválido → -32700", r.status === 400 && r.data.error.code === -32700, r.data);
r = await rpc(readKey, { jsonrpc: "2.0", id: 13, method: "ping" }, { origin: "https://evil.example" });
check("Origin ajeno → 403 (protección DNS rebinding)", r.status === 403, r.data);
r = await fetch(`${BASE}/mcp`, { headers: { authorization: `Bearer ${readKey}` } });
check("GET /mcp → 405", r.status === 405, r.status);

/* ---------------- Revoke ---------------- */
console.log("Revocar");
r = await owner("DELETE", `/api/integrations/api-keys/${fullId}`);
check("revocar → 204", r.status === 204, r.data);
r = await writer("GET", "/api/products");
check("la llave revocada deja de funcionar al instante", r.status === 401, r.data);
r = await rpc(fullKey, { jsonrpc: "2.0", id: 1, method: "tools/list" });
check("también en MCP", r.status === 401, r.data);
r = await rival("DELETE", `/api/integrations/api-keys/${fullId}`);
check("otro negocio no puede tocar llaves ajenas → 404", r.status === 404, r.data);
r = await owner("PUT", `/api/integrations/webhooks/${ep.id}`, { url: HOOK, description: null, events: [], active: false });
mark = hook.received.length;
await owner("POST", "/api/products", { name: `Clavo ${stamp}`, variants: [{ priceCents: 100 }] });
await sleep(800);
check("webhook desactivado no recibe nada", hook.received.length === mark, hook.received.slice(mark).map((h) => h.payload?.type));
r = await owner("DELETE", `/api/integrations/webhooks/${ep.id}`);
check("eliminar webhook → 204", r.status === 204 && (await owner("GET", "/api/integrations")).data.webhooks.length === 0, r.data);

server.close();
console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
