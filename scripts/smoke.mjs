// End-to-end smoke test against a running API (default: wrangler dev on :8787).
// Usage: node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now();
let failures = 0;

function client() {
  let cookie = "";
  return async (method, path, body, extra = {}) => {
    const headers = { ...(cookie && { cookie }), ...(extra.headers ?? {}) };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

const owner = client();
const email = `duena+${stamp}@example.com`;
const password = "contrasena-segura-1";

console.log("Auth");
let r = await owner("GET", "/api/me");
check("me sin sesión → 401", r.status === 401, r);
r = await owner("POST", "/api/auth/register", { businessName: "Casa Olivo", ownerName: "María Olivo", email, password, currency: "MXN", timezone: "America/Mexico_City" });
check("registro → 201", r.status === 201, r.data);
const tenantId = r.data?.tenant?.id;
r = await owner("POST", "/api/auth/register", { businessName: "Otra", ownerName: "X", email, password });
check("correo duplicado → 409", r.status === 409 && r.data.error.fields?.email, r.data);
r = await owner("POST", "/api/auth/register", { businessName: "", ownerName: "X", email: "malo", password: "corta" });
check("validación → 422 con campos", r.status === 422 && r.data.error.fields.email && r.data.error.fields.password, r.data);
r = await owner("GET", "/api/me");
check("me con sesión", r.status === 200 && r.data.role === "owner" && r.data.tenant.id === tenantId, r.data);
r = await owner("POST", "/api/settings", {}, { headers: { origin: "https://malicioso.example" } });
check("origen ajeno → 403", r.status === 403, r.data);

console.log("Configuración");
r = await owner("GET", "/api/settings");
check("configuración sembrada", r.status === 200 && r.data.tradeName === "Casa Olivo" && r.data.currency === "MXN", r.data);
const settings = r.data;
r = await owner("PUT", "/api/settings", { ...settings, updatedAt: undefined, tradeName: "Casa Olivo Centro", taxId: "OLI010101AAA", pricesIncludeTax: true });
check("actualizar configuración", r.status === 200 && r.data.tradeName === "Casa Olivo Centro", r.data);

console.log("Impuestos y ubicaciones");
r = await owner("GET", "/api/taxes");
check("impuesto por defecto sembrado", r.status === 200 && r.data.length === 1 && r.data[0].isDefault, r.data);
const exento = r.data[0];
r = await owner("POST", "/api/taxes", { name: "IVA 16%", rateBps: 1600, isDefault: true, active: true });
check("crear IVA predeterminado", r.status === 201, r.data);
r = await owner("GET", "/api/taxes");
check("solo un predeterminado", r.data.filter((t) => t.isDefault).length === 1 && r.data.find((t) => t.isDefault).rateBps === 1600, r.data);
r = await owner("PUT", `/api/taxes/${r.data.find((t) => t.rateBps === 1600).id}`, { name: "IVA 16%", rateBps: 1600, isDefault: false, active: true });
check("no se puede quitar el único predeterminado → 409", r.status === 409, r.data);
r = await owner("GET", "/api/locations");
check("ubicación principal sembrada", r.data.length === 1 && r.data[0].isDefault, r.data);
r = await owner("POST", "/api/locations", { name: "Bodega norte", type: "warehouse", address: null, isDefault: false, active: true });
check("crear bodega", r.status === 201, r.data);
r = await owner("POST", "/api/locations", { name: "Bodega norte", type: "warehouse", address: null, isDefault: false, active: true });
check("nombre duplicado → 409", r.status === 409, r.data);
void exento;

console.log("Usuarios y permisos");
const cashierEmail = `cajero+${stamp}@example.com`;
r = await owner("POST", "/api/users", { name: "Luis Cajero", email: cashierEmail, role: "cashier", password: "otra-contrasena-1" });
check("crear cajero", r.status === 201, r.data);
const cashierId = r.data?.userId;
r = await owner("GET", "/api/users");
check("listar usuarios", r.status === 200 && r.data.length === 2, r.data);
const cashier = client();
r = await cashier("POST", "/api/auth/login", { email: cashierEmail, password: "otra-contrasena-1" });
check("login del cajero", r.status === 200 && r.data.role === "cashier", r.data);
r = await cashier("GET", "/api/settings");
check("cajero lee configuración", r.status === 200);
r = await cashier("PUT", "/api/settings", settings);
check("cajero no edita configuración → 403", r.status === 403, r.data);
r = await cashier("GET", "/api/users");
check("cajero no ve usuarios → 403", r.status === 403);
r = await owner("PATCH", `/api/users/${r.data ? cashierId : cashierId}`, { active: false });
check("desactivar cajero", r.status === 200 && r.data.active === false, r.data);
r = await cashier("GET", "/api/me");
check("sesión del cajero desactivado → 401", r.status === 401, r.data);
r = await owner("PATCH", `/api/users/${(await owner("GET", "/api/me")).data.user.id}`, { role: "cashier" });
check("propietario bloqueado → 409", r.status === 409, r.data);

console.log("Aislamiento entre negocios");
const other = client();
r = await other("POST", "/api/auth/register", { businessName: "Ferretería Sol", ownerName: "Ana Sol", email: `ana+${stamp}@example.com`, password });
check("segundo negocio", r.status === 201);
r = await other("GET", "/api/locations");
check("solo ve sus ubicaciones", r.data.length === 1 && r.data[0].name === "Tienda principal", r.data);
r = await other("GET", "/api/users");
check("solo ve sus usuarios", r.data.length === 1, r.data);

console.log("Archivos (R2)");
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0));
const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "logo.png");
r = await owner("POST", "/api/uploads", form);
check("subir imagen", r.status === 201 && r.data.key.startsWith(`t/${tenantId}/`), r.data);
const fileUrl = r.data?.url;
r = await owner("GET", fileUrl);
check("leer imagen", r.status === 200 && r.headers.get("content-type") === "image/png", r.status);
const svg = new FormData();
svg.append("file", new Blob(["<svg/>"], { type: "image/svg+xml" }), "x.svg");
r = await owner("POST", "/api/uploads", svg);
check("SVG rechazado → 422", r.status === 422, r.data);

console.log("Auditoría");
r = await owner("GET", "/api/audit?limit=50");
const actions = r.data.items.map((i) => i.action);
check("registra las acciones", ["tenant.create", "settings.update", "tax.create", "location.create", "user.create", "user.update"].every((a) => actions.includes(a)), actions);
const settingsEntry = r.data.items.find((i) => i.action === "settings.update");
check("guarda antes y después", settingsEntry?.before?.tradeName === "Casa Olivo" && settingsEntry?.after?.tradeName === "Casa Olivo Centro", settingsEntry);

console.log("Contraseña");
const anon = client();
for (let i = 0; i < 5; i++) await anon("POST", "/api/auth/login", { email, password: "incorrecta" });
r = await anon("POST", "/api/auth/login", { email, password });
check("bloqueo tras 5 intentos fallidos → 429", r.status === 429, r.data);
r = await anon("POST", "/api/auth/password/forgot", { email });
check("solicitar restablecimiento", r.status === 200 && r.data.devResetUrl, r.data);
const token = new URL(r.data.devResetUrl).searchParams.get("token");
r = await anon("POST", "/api/auth/password/reset", { token, password: "nueva-contrasena-1" });
check("restablecer contraseña", r.status === 204, r.data);
r = await anon("POST", "/api/auth/password/reset", { token, password: "nueva-contrasena-1" });
check("el enlace solo sirve una vez → 400", r.status === 400, r.data);
r = await owner("GET", "/api/me");
check("las sesiones anteriores se cierran", r.status === 401);
r = await anon("POST", "/api/auth/password/forgot", { email: `nadie+${stamp}@example.com` });
check("correo inexistente no se revela → 204", r.status === 204);

console.log("Sesión");
const again = client();
r = await again("POST", "/api/auth/logout");
check("logout sin sesión → 204", r.status === 204);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
