// End-to-end test of the platform administration panel (/admin and /api/platform) against a running API in
// development: operator accounts and sign-in, metrics, businesses, users, the platform log, support tickets
// and "Entrar como negocio" (support access).
//   node scripts/smoke-platform.mjs [http://localhost:8787]
const BASE = process.argv[2] ?? "http://localhost:8787";
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}

/** A browser: keeps every cookie (nx_session, nx_support, nx_platform) like a real one. */
function client() {
  const jar = new Map();
  const call = async (method, path, body, headers = {}) => {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let payload;
    if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";");
      const [k, ...v] = pair.split("=");
      const expired = attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || !v.join("=")) jar.delete(k.trim()); else jar.set(k.trim(), v.join("="));
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  call.jar = jar;
  return call;
}

const pwd = "contrasena-segura-1";
const op = client(), op2 = client(), owner = client(), cashier = client(), other = client(), anon = client();
const OP_EMAIL = `ana-${stamp}@nexo.example`.toLowerCase();
const OP2_EMAIL = `beto-${stamp}@nexo.example`.toLowerCase();
const OWNER_EMAIL = `olga-${stamp}@example.com`.toLowerCase();

/* ---------------- Setup ---------------- */
let r = await owner("POST", "/api/auth/register", { businessName: `Abarrotes ${stamp}`, ownerName: "Olga Dueña", email: OWNER_EMAIL, password: pwd });
const tenantId = r.data.tenant.id, ownerId = r.data.user.id;
await other("POST", "/api/auth/register", { businessName: `Otro ${stamp}`, ownerName: "Óscar Otro", email: `oscar-${stamp}@example.com`, password: pwd });
r = await owner("POST", "/api/users", { name: "Carla Cajera", email: `carla-${stamp}@example.com`, password: pwd, role: "cashier" });
const cashierId = r.data.userId;
await cashier("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: pwd });
await anon("POST", "/api/dev/operator", { email: OP_EMAIL, name: "Ana Operadora", password: pwd });

/* ---------------- Separation from the business panel ---------------- */
console.log("Panel aparte");
r = await owner("GET", "/api/me");
check("el /me del negocio ya no dice platformAdmin", r.status === 200 && !("platformAdmin" in r.data) && r.data.support === null, r.data);
r = await owner("GET", "/api/platform/tenants");
check("una sesión de negocio no entra a /api/platform (401)", r.status === 401, r.data);
r = await anon("GET", "/api/platform/me");
check("sin sesión → 401", r.status === 401, r.data);
r = await fetch(`${BASE}/admin/negocios`);
const html = await r.text();
check("/admin/* sirve el panel de administración con noindex", r.status === 200 && html.includes("Nexo · Administración") && r.headers.get("x-robots-tag")?.includes("noindex") && r.headers.get("x-frame-options") === "DENY", { status: r.status, h: r.headers.get("x-robots-tag") });
r = await fetch(`${BASE}/admin`, { redirect: "manual" });
check("/admin redirige a /admin/", r.status === 301 && r.headers.get("location")?.endsWith("/admin/"), r.status);
r = await fetch(`${BASE}/productos`);
check("el panel del negocio sigue en su lugar", r.status === 200 && !(await r.text()).includes("Administración"), r.status);

/* ---------------- Operator sign-in ---------------- */
console.log("Operadores: inicio de sesión");
r = await op("POST", "/api/platform/auth/login", { email: OP_EMAIL, password: "equivocada-123" });
check("contraseña incorrecta → 401", r.status === 401, r.data);
r = await op("POST", "/api/platform/auth/login", { email: OWNER_EMAIL, password: pwd });
check("un usuario de negocio no es operador → 401", r.status === 401, r.data);
r = await op("POST", "/api/platform/auth/login", { email: OP_EMAIL.toUpperCase(), password: pwd });
check("operador entra (correo sin importar mayúsculas)", r.status === 200 && r.data.operator.name === "Ana Operadora" && op.jar.has("nx_platform"), r.data);
r = await op("GET", "/api/platform/me");
check("/platform/me", r.status === 200 && r.data.operator.email === OP_EMAIL && typeof r.data.openTickets === "number", r.data);
r = await op("GET", "/api/me");
check("la cookie de operador no abre el panel de un negocio", r.status === 401, r.data);
r = await op("POST", "/api/platform/auth/login", { email: OP_EMAIL, password: pwd }, { origin: "https://evil.example" });
check("origen ajeno → 403 (CSRF)", r.status === 403, r.data);

/* ---------------- Metrics ---------------- */
console.log("Métricas");
await owner("POST", "/api/dev/plan", { plan: "pro" });
const loc = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;
r = await owner("POST", "/api/products", { name: `Café ${stamp}`, variants: [{ priceCents: 5000 }] });
const variant = r.data.variants[0].id;
await owner("POST", "/api/inventory/adjust", { variantId: variant, locationId: loc, quantity: 10, reason: "initial", note: null }).catch(() => {});
r = await op("GET", "/api/platform/metrics");
check("métricas: negocios, planes, usuarios, 30 días y 12 meses", r.status === 200 && r.data.tenants.total >= 2 && r.data.byPlan.pro >= 1 && r.data.activity.days.length === 30 && r.data.signups.length === 12 && r.data.users.total >= 3, r.data);
check("un plan puesto a mano cuenta como cortesía, no como ingreso", r.data.billing.courtesy >= 1, r.data.billing);

/* ---------------- Businesses ---------------- */
console.log("Negocios");
r = await op("GET", `/api/platform/tenants?q=${encodeURIComponent(OWNER_EMAIL)}`);
check("buscar por correo del propietario", r.status === 200 && r.data.items.length === 1 && r.data.items[0].id === tenantId && r.data.items[0].openTickets === 0, r.data);
r = await op("GET", `/api/platform/tenants/${tenantId}`);
check("detalle con personas, tickets y bitácora", r.status === 200 && r.data.people.length === 2 && r.data.people[0].role === "owner" && Array.isArray(r.data.tickets) && Array.isArray(r.data.log) && r.data.currency === "MXN", r.data);
r = await op("PATCH", `/api/platform/tenants/${tenantId}`, { plan: "business" });
check("cambiar plan", r.status === 200 && r.data.plan === "business" && r.data.log[0]?.action === "tenant.plan" && r.data.log[0].summary === "Pro → Negocio", r.data.log?.[0]);
r = await op("PATCH", `/api/platform/tenants/${tenantId}`, { status: "suspended", suspendedReason: "Prueba" });
check("suspender (queda en la bitácora con el motivo)", r.status === 200 && r.data.status === "suspended" && r.data.log[0].action === "tenant.suspend" && r.data.log[0].summary === "Motivo: Prueba", r.data.log?.[0]);
r = await op("POST", `/api/platform/tenants/${tenantId}/support-access`, { reason: "Revisar algo del negocio" });
check("no se entra a un negocio suspendido", r.status === 409, r.data);
r = await op("PATCH", `/api/platform/tenants/${tenantId}`, { status: "active" });
check("reactivar", r.status === 200 && r.data.status === "active", r.data);

/* ---------------- Support tickets ---------------- */
console.log("Tickets de soporte");
r = await cashier("POST", "/api/support/tickets", { subject: "Ayuda", body: "Hola" });
check("un cajero no abre tickets (403)", r.status === 403, r.data);
r = await owner("POST", "/api/support/tickets", { subject: "El corte no cuadra", category: "problem", body: "El corte del martes tiene $50 de diferencia.", allowAccess: false });
const ticket = r.data;
check("el propietario abre un ticket con número y primer mensaje", r.status === 201 && ticket.number > 1000 && ticket.status === "open" && ticket.priority === "high" && ticket.thread.length === 1, r.data);
r = await owner("POST", "/api/support/tickets", { subject: "Duda de impuestos", body: "¿Cómo pongo IVA?" });
check("los números son consecutivos", r.data.number === ticket.number + 1, r.data.number);
const ticket2 = r.data;
r = await other("GET", `/api/support/tickets/${ticket.id}`);
check("otro negocio no ve el ticket (404)", r.status === 404, r.data);
r = await op("GET", "/api/platform/tickets");
const queued = r.data.items.find((t) => t.id === ticket.id);
check("aparece en la cola de soporte con su negocio", Boolean(queued) && queued.tenant.id === tenantId && queued.assignedTo === null && queued.messages === 1, queued);
r = await op("GET", `/api/platform/tickets?q=%23${ticket.number}`);
check("buscar por #número", r.data.items.length === 1 && r.data.items[0].id === ticket.id, r.data.items.map((t) => t.number));
r = await op("GET", "/api/platform/me");
check("el contador del menú cuenta los por responder", r.data.openTickets >= 2, r.data);
r = await op("POST", `/api/platform/tickets/${ticket.id}/messages`, { body: "Revisando con el equipo de caja.", internal: true });
check("nota interna: no cambia el estado", r.status === 200 && r.data.status === "open" && r.data.thread.at(-1).internal === true, r.data.status);
r = await op("POST", `/api/platform/tickets/${ticket.id}/messages`, { body: "Hola Olga, ¿nos das permiso para entrar a revisar?" });
check("respuesta: pasa a esperando al negocio y se asigna a quien responde", r.status === 200 && r.data.status === "waiting" && r.data.assignedTo?.name === "Ana Operadora", r.data);
r = await owner("GET", `/api/support/tickets/${ticket.id}`);
check("el negocio ve la respuesta pero no la nota interna", r.data.status === "waiting" && r.data.thread.length === 2 && r.data.thread.every((m) => !m.internal) && r.data.thread[1].authorType === "operator", r.data.thread);
r = await owner("GET", "/api/me");
check("y un aviso en su menú (supportWaiting)", r.data.supportWaiting === 1, r.data.supportWaiting);
r = await owner("PATCH", `/api/support/tickets/${ticket.id}`, { allowAccess: true });
check("da permiso para entrar (queda anotado)", r.data.allowAccess === true && r.data.thread.at(-1).authorType === "system", r.data.thread.at(-1));
r = await owner("POST", `/api/support/tickets/${ticket.id}/messages`, { body: "Sí, adelante." });
check("responder lo regresa a la cola", r.data.status === "open", r.data.status);
r = await op("PATCH", `/api/platform/tickets/${ticket2.id}`, { priority: "urgent", status: "closed" });
check("operador cierra y cambia prioridad", r.status === 200 && r.data.status === "closed" && r.data.priority === "urgent", r.data);
r = await owner("GET", `/api/support/tickets/${ticket2.id}`);
check("el negocio ve que se cerró", r.data.status === "closed" && r.data.thread.at(-1).body.includes("cerró"), r.data.thread.at(-1));
r = await owner("POST", `/api/support/tickets/${ticket2.id}/messages`, { body: "Una duda más" });
check("si el negocio escribe en uno cerrado, se reabre", r.data.status === "open" && r.data.closedAt === null, r.data);

/* ---------------- Support access ---------------- */
console.log("Entrar como negocio");
r = await op("POST", `/api/platform/tenants/${tenantId}/support-access`, { reason: "corto" });
check("sin ticket con permiso, el motivo es obligatorio", r.status === 422 && r.data.error.fields.reason, r.data);
r = await op("POST", `/api/platform/tenants/${tenantId}/support-access`, { ticketId: ticket2.id });
check("un ticket sin permiso también pide motivo", r.status === 422, r.data);
r = await op("POST", `/api/platform/tenants/${tenantId}/support-access`, { ticketId: ticket.id });
check("con el ticket que dio permiso: entra", r.status === 200 && r.data.owner === "Olga Dueña" && op.jar.has("nx_support"), r.data);
r = await op("GET", "/api/me");
check("/me en modo soporte: quién, hasta cuándo y el ticket", r.status === 200 && r.data.tenant.id === tenantId && r.data.role === "owner" && r.data.support?.operatorName === "Ana Operadora" && r.data.support.ticketNumber === ticket.number && r.data.user.name === "Soporte Nexo · Ana Operadora", r.data);
r = await op("POST", "/api/products", { name: `Hecho por soporte ${stamp}`, variants: [{ priceCents: 100 }] });
check("puede trabajar en el negocio", r.status === 201, r.data);
const supportProduct = r.data.id;
r = await owner("GET", "/api/audit?entity=product");
const auditRow = (r.data.items ?? r.data).find((a) => a.entityId === supportProduct);
check("y queda en su actividad con el nombre de soporte", auditRow?.userName === "Soporte Nexo · Ana Operadora", auditRow);
r = await owner("GET", "/api/audit");
check("la actividad del negocio registra la entrada de soporte", (r.data.items ?? r.data).some((a) => a.action === "support.access" && a.after?.reason?.includes(`#${ticket.number}`)), (r.data.items ?? r.data).slice(0, 3));
for (const [method, path, body] of [["POST", "/api/integrations/api-keys", { name: "x", access: "read" }], ["POST", "/api/billing/portal"], ["POST", "/api/users", { name: "X", email: `x-${stamp}@example.com`, password: pwd, role: "admin" }], ["POST", "/api/auth/password/change", { currentPassword: pwd, newPassword: "otra-contrasena-1" }], ["POST", "/api/support/tickets", { subject: "Hola", body: "x" }]]) {
  r = await op(method, path, body);
  check(`soporte no puede: ${method} ${path}`, r.status === 403 && r.data.error.code === "forbidden_for_support", r.data);
}
r = await op("GET", "/api/users");
check("pero sí puede ver (GET)", r.status === 200, r.data);
r = await owner("GET", `/api/support/tickets/${ticket.id}`);
check("el ticket dice que soporte entró", r.data.thread.some((m) => m.authorType === "system" && m.body.includes("entró a la cuenta")), r.data.thread.map((m) => m.body));
r = await owner("GET", "/api/me");
check("la sesión del propietario no se entera", r.status === 200 && r.data.support === null && r.data.user.name === "Olga Dueña", r.data);
r = await op("POST", "/api/auth/support/exit");
check("salir del modo soporte regresa al ticket", r.status === 200 && r.data.redirect === `/admin/soporte/${ticket.id}` && !op.jar.has("nx_support"), r.data);
r = await op("GET", "/api/me");
check("y la sesión de soporte ya no sirve", r.status === 401, r.data);
r = await op("GET", "/api/platform/me");
check("el operador sigue en /admin", r.status === 200, r.data);
r = await op("POST", `/api/platform/tenants/${tenantId}/support-access`, { reason: "Revisar inventario por un reporte" });
check("sin ticket, con motivo: entra", r.status === 200, r.data);
r = await op("POST", "/api/auth/logout");
check("cerrar sesión en modo soporte solo termina el modo soporte", r.status === 204 && !op.jar.has("nx_support"), [...op.jar.keys()]);
r = await op("GET", "/api/platform/me");
check("(la sesión de operador sigue)", r.status === 200, r.data);

/* ---------------- Users ---------------- */
console.log("Usuarios");
r = await op("GET", `/api/platform/users?q=${encodeURIComponent(`Abarrotes ${stamp}`)}`);
check("buscar usuarios por negocio", r.status === 200 && r.data.items.length === 2 && r.data.items.every((u) => u.memberships[0].tenantId === tenantId), r.data);
r = await op("GET", `/api/platform/users/${ownerId}`);
check("detalle: negocios, sesiones y último acceso", r.status === 200 && r.data.memberships[0].role === "owner" && r.data.sessions >= 1 && r.data.lastLoginAt, r.data);
const thief = client();
for (let i = 0; i < 5; i++) await thief("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: "mala-mala-mala" });
r = await thief("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: pwd });
check("5 intentos fallidos bloquean el inicio de sesión", r.status === 429, r.data);
r = await op("GET", "/api/platform/users?status=locked");
check("aparece en «Bloqueados»", r.data.items.some((u) => u.id === cashierId && u.locked), r.data.items.map((u) => u.email));
r = await op("POST", `/api/platform/users/${cashierId}/unlock`);
check("desbloquear", r.status === 200 && r.data.locked === false, r.data);
r = await thief("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: pwd });
check("ya puede entrar", r.status === 200, r.data);
r = await op("POST", `/api/platform/users/${cashierId}/reset-link`);
check("enlace para cambiar contraseña", r.status === 200 && r.data.url.includes("/restablecer?token="), r.data);
const token = new URL(r.data.url).searchParams.get("token");
r = await anon("POST", "/api/auth/password/reset", { token, password: "nueva-contrasena-9" });
check("el enlace funciona", r.status === 204, r.data);
r = await cashier("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: "nueva-contrasena-9" });
check("con la contraseña nueva", r.status === 200, r.data);
r = await op("PATCH", `/api/platform/users/${cashierId}`, { disabled: true });
check("desactivar cuenta", r.status === 200 && r.data.disabledAt && r.data.sessions === 0, r.data);
r = await cashier("GET", "/api/me");
check("su sesión se cerró", r.status === 401, r.data);
r = await cashier("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: "nueva-contrasena-9" });
check("y no puede entrar (account_disabled)", r.status === 403 && r.data.error.code === "account_disabled", r.data);
r = await anon("POST", "/api/auth/password/forgot", { email: `carla-${stamp}@example.com` });
check("recuperar contraseña no genera enlace para una cuenta desactivada", r.status === 204, r.data);
r = await op("PATCH", `/api/platform/users/${cashierId}`, { disabled: false });
r = await cashier("POST", "/api/auth/login", { email: `carla-${stamp}@example.com`, password: "nueva-contrasena-9" });
check("reactivada, vuelve a entrar", r.status === 200, r.data);
r = await op("POST", `/api/platform/users/${cashierId}/logout-all`);
check("cerrar todas sus sesiones", r.status === 200 && r.data.sessions === 0, r.data);
r = await cashier("GET", "/api/me");
check("(se cerró)", r.status === 401, r.data);

/* ---------------- Operators ---------------- */
console.log("Operadores");
r = await op("POST", "/api/platform/operators", { name: "Beto Soporte", email: OP2_EMAIL, password: pwd });
const op2Id = r.data.id;
check("crear operador", r.status === 201 && r.data.active, r.data);
r = await op("POST", "/api/platform/operators", { name: "Otro", email: OP2_EMAIL, password: pwd });
check("correo repetido → 409", r.status === 409, r.data);
r = await op2("POST", "/api/platform/auth/login", { email: OP2_EMAIL, password: pwd });
check("el nuevo entra", r.status === 200, r.data);
r = await op("PATCH", `/api/platform/tickets/${ticket.id}`, { assignedTo: op2Id });
check("asignar un ticket a otro operador", r.data.assignedTo?.id === op2Id, r.data.assignedTo);
r = await op2("GET", "/api/platform/tickets?assigned=me");
check("lo ve en «Míos»", r.data.items.some((t) => t.id === ticket.id), r.data.items.length);
const meId = (await op("GET", "/api/platform/me")).data.operator.id;
r = await op("PATCH", `/api/platform/operators/${meId}`, { active: false });
check("no puede desactivarse a sí mismo", r.status === 409, r.data);
r = await op("PATCH", `/api/platform/operators/${op2Id}`, { password: "clave-nueva-de-beto" });
check("ponerle contraseña nueva a otro operador cierra sus sesiones", r.status === 200 && (await op2("GET", "/api/platform/me")).status === 401, r.data);
await op2("POST", "/api/platform/auth/login", { email: OP2_EMAIL, password: "clave-nueva-de-beto" });
await op2("POST", `/api/platform/tenants/${tenantId}/support-access`, { reason: "Revisar el reporte de ventas" });
r = await op2("GET", "/api/me");
check("(Beto entra a un negocio)", r.status === 200 && r.data.support?.operatorName === "Beto Soporte", r.data);
r = await op("PATCH", `/api/platform/operators/${op2Id}`, { active: false });
check("desactivar a otro operador", r.status === 200 && r.data.active === false, r.data);
r = await op2("GET", "/api/platform/me");
check("queda fuera de /admin al instante", r.status === 401, r.data);
r = await op2("GET", "/api/me");
check("y fuera del negocio en el que estaba", r.status === 401, r.data);
r = await op2("POST", "/api/platform/auth/login", { email: OP2_EMAIL, password: "clave-nueva-de-beto" });
check("y no puede volver a entrar", r.status === 401, r.data);
r = await op("POST", "/api/platform/auth/password", { currentPassword: "mala", newPassword: "otra-clave-larga-1" });
check("cambiar mi contraseña pide la actual", r.status === 422 && r.data.error.fields.currentPassword, r.data);
r = await op("POST", "/api/platform/auth/password", { currentPassword: pwd, newPassword: "otra-clave-larga-1" });
check("cambiar mi contraseña", r.status === 204 && (await op("GET", "/api/platform/me")).status === 200, r.data);
const brute = client();
for (let i = 0; i < 5; i++) await brute("POST", "/api/platform/auth/login", { email: OP_EMAIL, password: "intento-malo-123" });
r = await brute("POST", "/api/platform/auth/login", { email: OP_EMAIL, password: "otra-clave-larga-1" });
check("5 intentos fallidos bloquean al operador 15 minutos", r.status === 429, r.data);

/* ---------------- Platform log ---------------- */
console.log("Bitácora");
r = await op("GET", `/api/platform/audit?tenantId=${tenantId}&pageSize=100`);
const actions = new Set(r.data.items.map((e) => e.action));
check("del negocio: plan, suspensión, tickets y accesos", ["tenant.plan", "tenant.suspend", "tenant.reactivate", "tenant.support_access", "ticket.reply", "ticket.note", "ticket.update", "user.unlock", "user.reset_link", "user.disable", "user.enable", "user.logout_all"].every((a) => actions.has(a)), [...actions]);
check("con el nombre del negocio", r.data.items.every((e) => e.tenantName === `Abarrotes ${stamp}`), r.data.items[0]);
r = await op("GET", `/api/platform/audit?operatorId=${meId}&entity=operator&pageSize=100`);
const opActions = new Set(r.data.items.map((e) => e.action));
check("del operador: entradas, intentos fallidos, altas y cambios", ["operator.login", "operator.login_failed", "operator.create", "operator.update", "operator.password"].every((a) => opActions.has(a)), [...opActions]);
r = await op("GET", "/api/platform/audit?pageSize=2&page=2");
check("paginada", r.status === 200 && r.data.items.length === 2 && r.data.page === 2 && r.data.total > 4, r.data.total);
r = await op("POST", "/api/platform/auth/logout");
check("cerrar sesión de operador", r.status === 204 && (await op("GET", "/api/platform/me")).status === 401, r.data);

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
