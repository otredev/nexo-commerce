// End-to-end test of granular permissions against a running API in development: custom roles of a business
// (what they open and block, no privilege escalation, live changes), and in /admin, operator permissions and
// changing a person's role inside a business.
//   node scripts/smoke-roles.mjs [http://localhost:8787]
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

const pwd = "contrasena-segura-1";
const owner = client(), store = client(), boss = client(), adminU = client(), op = client(), helper = client(), roOp = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Ferretería ${stamp}`, ownerName: "Fer Dueño", email: `fer-${stamp}@example.com`, password: pwd });
const tenantId = r.data.tenant.id;
await owner("POST", "/api/dev/plan", { plan: "business" });

/* ---------------- Custom roles ---------------- */
console.log("Roles personalizados");
r = await owner("GET", "/api/me");
check("/me trae permisos y nombre del rol", r.data.permissions.includes("billing:write") && r.data.roleName === "Propietario", { roleName: r.data.roleName, n: r.data.permissions.length });
r = await owner("POST", "/api/users/roles", { name: "Almacenista", permissions: [] });
check("un rol sin permisos → 422", r.status === 422 && r.data.error.fields.permissions, r.data);
r = await owner("POST", "/api/users/roles", { name: "Almacenista", description: "Inventario y compras, sin ventas", permissions: ["catalog:read", "inventory:read", "inventory:write", "purchases:read", "purchases:write", "purchases:receive", "suppliers:read", "billing:write", "no:existe"] });
const storeRole = r.data;
check("crear rol (descarta permisos inexistentes y los del propietario)", r.status === 201 && storeRole.permissions.length === 7 && !storeRole.permissions.includes("billing:write") && storeRole.members === 0, r.data);
r = await owner("POST", "/api/users/roles", { name: "Almacenista", permissions: ["catalog:read"] });
check("mismo nombre exacto → 409", r.status === 409 && r.data.error.fields.name, r.data);
r = await owner("POST", "/api/users/roles", { name: "Encargado", permissions: ["pos:sell", "cash:operate", "cash:review", "sales:read", "sales:void", "users:read", "users:write", "catalog:read", "orders:read", "orders:fulfill"] });
const bossRole = r.data;

r = await owner("POST", "/api/users", { name: "Alma Almacén", email: `alma-${stamp}@example.com`, role: "cashier", roleId: storeRole.id, password: pwd });
const almaId = r.data.userId;
check("crear usuario con rol personalizado", r.status === 201 && r.data.roleId === storeRole.id && r.data.roleName === "Almacenista", r.data);
r = await owner("POST", "/api/users", { name: "Beto Encargado", email: `beto-${stamp}@example.com`, role: "cashier", roleId: bossRole.id, password: pwd });
const betoId = r.data.userId;
r = await owner("POST", "/api/users", { name: "Ada Admin", email: `ada-${stamp}@example.com`, role: "admin", password: pwd });
const adaId = r.data.userId;
r = await owner("GET", "/api/users");
check("la lista muestra el rol de cada quien", r.data.find((m) => m.userId === almaId)?.roleName === "Almacenista" && r.data.find((m) => m.userId === adaId)?.roleId === null, r.data.map((m) => [m.name, m.roleName]));
r = await owner("GET", "/api/users/roles");
check("los roles cuentan a sus personas", r.data.items.find((x) => x.id === storeRole.id)?.members === 1, r.data.items);

await store("POST", "/api/auth/login", { email: `alma-${stamp}@example.com`, password: pwd });
r = await store("GET", "/api/me");
check("Alma entra con los permisos de su rol", r.data.roleName === "Almacenista" && r.data.permissions.includes("inventory:write") && !r.data.permissions.includes("pos:sell"), r.data);
r = await store("GET", "/api/products");
check("puede ver productos", r.status === 200, r.status);
r = await store("POST", "/api/products", { name: `Clavo ${stamp}`, variants: [{ priceCents: 100 }] });
check("no puede crear productos (no está en su rol)", r.status === 403, r.data);
r = await store("GET", "/api/sales");
check("no ve ventas", r.status === 403, r.data);
r = await store("GET", "/api/purchases");
check("sí ve compras", r.status === 200, r.status);
r = await store("GET", "/api/users");
check("no ve usuarios", r.status === 403, r.data);

/* Live changes: editing the role changes what Alma can do at once. */
r = await owner("PUT", `/api/users/roles/${storeRole.id}`, { name: "Almacenista", description: null, permissions: [...storeRole.permissions, "catalog:write"] });
check("editar el rol", r.status === 200 && r.data.permissions.includes("catalog:write") && r.data.members === 1, r.data);
r = await store("POST", "/api/products", { name: `Clavo ${stamp}`, variants: [{ priceCents: 100 }] });
check("Alma ya puede crear productos, sin volver a entrar", r.status === 201, r.data);

/* No escalation */
console.log("Sin escalar privilegios");
await boss("POST", "/api/auth/login", { email: `beto-${stamp}@example.com`, password: pwd });
r = await boss("GET", "/api/users");
check("el Encargado ve usuarios", r.status === 200, r.status);
r = await boss("POST", "/api/users", { name: "Nuevo Admin", email: `nadmin-${stamp}@example.com`, role: "admin", password: pwd });
check("no puede crear un Administrador (le faltan permisos)", r.status === 403 && r.data.error.code === "escalation", r.data);
r = await boss("POST", "/api/users", { name: "Nueva Cajera", email: `ncaja-${stamp}@example.com`, role: "cashier", password: pwd });
check("ni un Cajero: el Cajero tiene permisos que él no (clientes, inventario…)", r.status === 403 && r.data.error.code === "escalation", r.data);
r = await boss("POST", "/api/users", { name: "Nuevo Encargado", email: `nenc-${stamp}@example.com`, role: "cashier", roleId: bossRole.id, password: pwd });
check("sí puede crear a alguien con su mismo rol", r.status === 201 && r.data.roleName === "Encargado", r.data);
r = await boss("PATCH", `/api/users/${almaId}`, { roleId: bossRole.id });
check("no puede cambiar a alguien con permisos que él no tiene (Alma)", r.status === 403 && r.data.error.code === "escalation", r.data);
r = await boss("POST", "/api/users/roles", { name: "Súper", permissions: ["pos:sell", "reports:read"] });
check("no puede crear un rol con permisos que no tiene", r.status === 403 && r.data.error.code === "escalation", r.data);
r = await boss("PATCH", `/api/users/${betoId}`, { role: "admin" });
check("ni cambiarse a sí mismo", r.status === 409, r.data);
r = await boss("PATCH", `/api/users/${adaId}`, { active: false });
check("ni desactivar a un Administrador", r.status === 403 && r.data.error.code === "escalation", r.data);

/* Back to built-in roles and deleting */
r = await owner("DELETE", `/api/users/roles/${storeRole.id}`);
check("un rol con personas no se elimina", r.status === 409 && r.data.error.code === "role_in_use", r.data);
r = await owner("PATCH", `/api/users/${almaId}`, { role: "cashier" });
check("volver a un rol de Nexo quita el rol personalizado", r.status === 200 && r.data.roleId === null && r.data.role === "cashier", r.data);
r = await store("GET", "/api/me");
check("y Alma pasa a tener lo del Cajero", r.data.roleName === "Cajero" && !r.data.permissions.includes("inventory:write") && r.data.permissions.includes("pos:sell"), r.data.roleName);
r = await owner("DELETE", `/api/users/roles/${storeRole.id}`);
check("ya sin personas, se elimina", r.status === 204, r.data);
r = await owner("GET", "/api/audit");
const acts = new Set((r.data.items ?? r.data).map((a) => a.action));
check("todo queda en la actividad", ["role.create", "role.update", "role.delete", "user.update"].every((a) => acts.has(a)), [...acts]);

/* Cash closing: cashiers count blind unless their role says otherwise. */
console.log("Corte de caja");
const main = (await owner("GET", "/api/locations")).data.find((l) => l.isDefault).id;
r = await boss("POST", "/api/cash/open", { locationId: main, openingCashCents: 10000 });
check("con «Ver el efectivo esperado» el Encargado ve el esperado", (r.status === 201 || r.status === 200) && r.data.expectedCashCents === 10000, { status: r.status, expected: r.data?.expectedCashCents, err: r.data?.error });
await owner("PUT", `/api/users/roles/${bossRole.id}`, { name: "Encargado", description: null, permissions: bossRole.permissions.filter((p) => p !== "cash:review") });
r = await boss("GET", `/api/cash/current?locationId=${main}`);
check("sin él, su corte es a ciegas", r.status === 200 && r.data.expectedCashCents === null, r.data?.expectedCashCents);

/* ---------------- /admin: operator permissions ---------------- */
console.log("Permisos de operadores");
const anon = client();
await anon("POST", "/api/dev/operator", { email: `jefa-${stamp}@nexo.example`, name: "Jefa", password: pwd });
await op("POST", "/api/platform/auth/login", { email: `jefa-${stamp}@nexo.example`, password: pwd });
r = await op("GET", "/api/platform/me");
check("el primer operador tiene acceso completo", r.data.permissions.includes("operators:manage") && r.data.permissions.length === 12, r.data.permissions);
r = await op("POST", "/api/platform/operators", { name: "Hugo Soporte", email: `hugo-${stamp}@nexo.example`, password: pwd, permissions: ["tenants:read", "tenants:enter", "users:read", "users:manage", "support:read", "support:reply", "inventado"] });
const hugoId = r.data.id;
check("crear operador de soporte (descarta permisos inventados)", r.status === 201 && r.data.permissions.length === 6 && !r.data.permissions.includes("metrics:read"), r.data.permissions);
await helper("POST", "/api/platform/auth/login", { email: `hugo-${stamp}@nexo.example`, password: pwd });
r = await helper("GET", "/api/platform/me");
check("su /me dice lo que puede hacer", r.data.permissions.length === 6, r.data.permissions);
r = await helper("GET", "/api/platform/metrics");
check("no ve métricas (403)", r.status === 403, r.data);
r = await helper("GET", "/api/platform/audit");
check("no ve la bitácora", r.status === 403, r.data);
r = await helper("GET", `/api/platform/tenants/${tenantId}`);
check("ve negocios, sin bitácora en el detalle", r.status === 200 && r.data.log.length === 0, r.status);
r = await helper("PATCH", `/api/platform/tenants/${tenantId}`, { plan: "pro" });
check("no cambia planes", r.status === 403, r.data);
r = await helper("POST", "/api/platform/operators", { name: "X", email: `x-${stamp}@nexo.example`, password: pwd });
check("no crea operadores", r.status === 403, r.data);
r = await helper("GET", "/api/platform/tickets");
check("ve tickets", r.status === 200, r.status);
r = await helper("PATCH", `/api/platform/users/${almaId}/memberships/${tenantId}`, { role: "admin" });
check("sin «Cambiar el rol» no toca roles de negocios", r.status === 403, r.data);
r = await helper("POST", `/api/platform/users/${almaId}/unlock`);
check("sí desbloquea usuarios", r.status === 200, r.data);
r = await op("PATCH", `/api/platform/operators/${hugoId}`, { permissions: ["tenants:read"] });
check("quitarle permisos", r.status === 200 && r.data.permissions.length === 1, r.data);
r = await helper("GET", "/api/platform/tickets");
check("aplica en su siguiente clic", r.status === 403, r.data);
const me = (await op("GET", "/api/platform/me")).data.operator.id;
r = await op("PATCH", `/api/platform/operators/${me}`, { permissions: ["tenants:read"] });
check("nadie se quita a sí mismo «administrar operadores»", r.status === 409 && r.data.error.code === "self_lockout", r.data);
r = await op("POST", "/api/platform/operators", { name: "Rita Lectura", email: `rita-${stamp}@nexo.example`, password: pwd, permissions: ["metrics:read", "tenants:read", "users:read", "support:read", "audit:read"] });
await roOp("POST", "/api/platform/auth/login", { email: `rita-${stamp}@nexo.example`, password: pwd });
r = await roOp("POST", `/api/platform/tenants/${tenantId}/support-access`, { reason: "Revisar la configuración" });
check("solo lectura: no entra a negocios", r.status === 403, r.data);
r = await roOp("GET", "/api/platform/me");
check("(el contador de tickets sí, porque los puede ver)", typeof r.data.openTickets === "number", r.data);

/* ---------------- /admin: a person's role inside a business ---------------- */
console.log("Rol de un usuario desde /admin");
const encargadoId = bossRole.id;
r = await op("GET", `/api/platform/users/${almaId}`);
check("el detalle trae los roles de su negocio", r.data.tenantRoles[tenantId]?.some((x) => x.id === encargadoId), r.data.tenantRoles);
r = await op("PATCH", `/api/platform/users/${almaId}/memberships/${tenantId}`, { roleId: encargadoId });
check("cambiar a un rol del negocio", r.status === 200 && r.data.memberships[0].roleId === encargadoId && r.data.memberships[0].roleName === "Encargado", r.data.memberships);
r = await store("GET", "/api/me");
check("Alma tiene ya los permisos del Encargado", r.data.roleName === "Encargado" && r.data.permissions.includes("sales:void"), r.data.roleName);
r = await op("PATCH", `/api/platform/users/${almaId}/memberships/${tenantId}`, { role: "admin", roleId: null });
check("o a Administrador", r.status === 200 && r.data.memberships[0].role === "admin" && r.data.memberships[0].roleId === null, r.data.memberships);
const ownerId = (await owner("GET", "/api/me")).data.user.id;
r = await op("PATCH", `/api/platform/users/${ownerId}/memberships/${tenantId}`, { role: "cashier" });
check("el propietario no se toca", r.status === 409, r.data);
const otherBiz = client();
await otherBiz("POST", "/api/auth/register", { businessName: `Otro ${stamp}`, ownerName: "Otro", email: `otro-${stamp}@example.com`, password: pwd });
const otherRole = (await otherBiz("POST", "/api/users/roles", { name: "Ajeno", permissions: ["pos:sell"] })).data;
r = await op("PATCH", `/api/platform/users/${almaId}/memberships/${tenantId}`, { roleId: otherRole.id });
check("no se le puede poner un rol de otro negocio", r.status === 422, r.data);
r = await op("PATCH", `/api/platform/users/${almaId}/memberships/${tenantId}`, { active: false });
check("quitarle el acceso al negocio cierra su sesión ahí", r.status === 200 && r.data.memberships[0].active === false && (await store("GET", "/api/me")).status === 401, r.data.memberships);
r = await owner("GET", "/api/audit");
check("el negocio lo ve en su actividad, a nombre del operador", (r.data.items ?? r.data).some((a) => a.action === "user.update" && a.userName === "Soporte Nexo · Jefa" && a.entityId === almaId), (r.data.items ?? r.data).slice(0, 3));
r = await op("GET", `/api/platform/audit?tenantId=${tenantId}`);
check("y en la bitácora de la plataforma", r.data.items.some((e) => e.action === "user.role" && /Alma Almacén/.test(e.summary)), r.data.items.map((e) => e.summary));

console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
