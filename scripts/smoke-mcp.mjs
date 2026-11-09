// End-to-end test of the MCP tools for the catalog, inventory and the store against a running API in
// development: everything is done through /mcp with an API key, the way an AI assistant would.
// Usage: node scripts/smoke-mcp.mjs [baseUrl]
import { createServer } from "node:http";
const BASE = process.argv[2] ?? "http://localhost:8787";
const IMG_PORT = 12116;
const stamp = Date.now().toString(36).toUpperCase();
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)); }
}

// A tiny server with images (and a fake one) for subir_imagen. http/localhost is allowed only in development.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const server = createServer((req, res) => {
  if (req.url === "/ave.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG); }
  if (req.url === "/redirige") { res.writeHead(302, { location: "/ave.png" }); return res.end(); }
  if (req.url === "/falsa.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end("<script>alert(1)</script>"); }
  if (req.url === "/grande.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])); }
  res.writeHead(404); res.end();
});
await new Promise((ok) => server.listen(IMG_PORT, "127.0.0.1", ok));

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const h = { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) };
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
}
const owner = client();
let r = await owner("POST", "/api/auth/register", { businessName: `Aviario ${stamp}`, ownerName: "Héctor", email: `h-${stamp}@example.com`, password: "contrasena-segura-1" });
await owner("POST", "/api/dev/plan", { plan: "pro" });
await owner("POST", "/api/locations", { name: "Bodega", type: "warehouse", address: null, isDefault: false, active: true });
const fullKey = (await owner("POST", "/api/integrations/api-keys", { name: "Claude", access: "full" })).data.key;
const readKey = (await owner("POST", "/api/integrations/api-keys", { name: "Lectura", access: "read" })).data.key;

let n = 0;
async function tool(key, name, args = {}) {
  const res = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }) });
  const data = await res.json();
  const text = data.result?.content?.[0]?.text ?? "";
  let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { error: data.error, isError: data.result?.isError, text, json };
}
const ok = (t) => t.isError === false;

console.log("Categorías, marcas e impuestos");
let t = await tool(fullKey, "crear_categoria", { nombre: "Aves" });
check("crear_categoria", ok(t) && t.json.nombre === "Aves", t.text);
t = await tool(fullKey, "crear_categoria", { nombre: "Pequeñas", dentro_de: "aves" });
check("crear subcategoría por nombre del padre (sin importar mayúsculas)", ok(t) && t.json.dentro_de, t.text);
await tool(fullKey, "crear_categoria", { nombre: "Grandes", dentro_de: "Aves" });
await tool(fullKey, "crear_categoria", { nombre: "Semillas" });
t = await tool(fullKey, "crear_categoria", { nombre: "Aves" });
check("categoría repetida → isError", t.isError === true && /existe/i.test(t.text), t.text);
t = await tool(readKey, "listar_categorias");
check("listar_categorias con subcategorías anidadas", ok(t) && t.json.find((c) => c.nombre === "Aves")?.subcategorias.length === 2, t.json ?? t.text);
t = await tool(fullKey, "editar_categoria", { categoria: "Aves > Grandes", nombre: "Grandes y medianas" });
check("editar_categoria por «Padre > Hija»", ok(t) && t.json.nombre === "Grandes y medianas", t.text);
t = await tool(fullKey, "crear_marca", { nombre: "Vega" });
check("crear_marca", ok(t) && t.json.nombre === "Vega", t.text);
await tool(fullKey, "crear_marca", { nombre: "Temporal" });
t = await tool(fullKey, "guardar_impuesto", { nombre: "IVA 16", porcentaje: 16 });
check("guardar_impuesto crea uno", ok(t) && t.json.porcentaje === 16, t.text);
t = await tool(readKey, "listar_impuestos");
check("listar_impuestos", ok(t) && t.json.some((x) => x.porcentaje === 16), t.text);

console.log("Imágenes");
t = await tool(fullKey, "subir_imagen", { url: `http://127.0.0.1:${IMG_PORT}/redirige` });
const img = t.json?.clave;
check("subir_imagen desde un enlace (sigue redirecciones)", ok(t) && /^t\//.test(img), t.text);
t = await tool(fullKey, "subir_imagen", { url: `http://127.0.0.1:${IMG_PORT}/falsa.png` });
check("un archivo que dice ser imagen pero no lo es → isError", t.isError === true && /no es una imagen/i.test(t.text), t.text);
t = await tool(fullKey, "subir_imagen", { url: `http://127.0.0.1:${IMG_PORT}/grande.png` });
check("más de 5 MB → isError", t.isError === true && /5 MB/.test(t.text), t.text);
t = await tool(fullKey, "subir_imagen", { url: "javascript:alert(1)" });
check("dirección no válida → isError", t.isError === true, t.text);

console.log("Productos");
t = await tool(fullKey, "crear_producto", { nombre: "Periquito", categoria: "Aves > Pequeñas", marca: "vega", impuesto: 16, precio_centavos: 29990, costo_centavos: 15000, sku: `PER-${stamp}`, existencia_inicial: 5, en_linea: true, imagenes: [img], palabras_clave: ["#Mascota", "ave"] });
const per = t.json;
check("crear_producto sencillo con categoría, marca e impuesto por nombre", ok(t) && per.variantes.length === 1 && per.variantes[0].existencia === 5 && per.imagenes[0] === img && per.palabras_clave.join() === "mascota,ave", t.text);
t = await tool(fullKey, "crear_producto", { nombre: "Jaula", categoria: "Inventada", precio_centavos: 100 });
check("categoría inexistente → isError que sugiere crear_categoria", t.isError === true && /crear_categoria/.test(t.text), t.text);
t = await tool(fullKey, "crear_producto", { nombre: "Jaula", precio_centavos: 100, opciones: ["Tamaño"] });
check("opciones sin variantes → error de la API, no un producto a medias", t.isError === true, t.text);
t = await tool(fullKey, "crear_producto", {
  nombre: "Jaula", categoria: "Aves", opciones: ["Tamaño"],
  variantes: [{ opciones: ["Chica"], sku: `JAU-S-${stamp}`, precio_centavos: 49900, existencia_inicial: 3 }, { opciones: ["Grande"], sku: `JAU-L-${stamp}`, precio_centavos: 149900, existencia_inicial: 1 }],
});
check("crear_producto con variantes", ok(t) && t.json.variantes.length === 2 && t.json.opciones[0] === "Tamaño", t.text);
t = await tool(fullKey, "editar_producto", { producto: `JAU-S-${stamp}`, cambiar_variantes: [{ variante: `JAU-L-${stamp}`, precio_centavos: 139900 }], agregar_variantes: [{ opciones: ["Mediana"], sku: `JAU-M-${stamp}`, precio_centavos: 89900 }], descripcion: "Acero inoxidable" });
const jau = t.json;
check("editar_producto por SKU: cambia una variante, agrega otra y la descripción", ok(t) && jau.variantes.length === 3 && jau.variantes.find((v) => v.sku === `JAU-L-${stamp}`).precio_centavos === 139900 && jau.variantes.find((v) => v.sku === `JAU-L-${stamp}`).existencia === 1, t.text);
t = await tool(fullKey, "editar_producto", { producto: "Periquito", en_linea: false, marca: null });
check("editar_producto por nombre: solo cambia lo enviado", ok(t) && t.json.en_linea === false && t.json.marcaId === null && t.json.variantes[0].precio_centavos === 29990 && t.json.imagenes[0] === img, t.text);
t = await tool(fullKey, "editar_producto", { producto: "Periquito", cambiar_variantes: [{ variante: "NO-EXISTE", precio_centavos: 1 }] });
check("variante inexistente → isError con las variantes", t.isError === true && t.text.includes(`PER-${stamp}`), t.text);
t = await tool(readKey, "crear_producto", { nombre: "X", precio_centavos: 1 });
check("llave de lectura no puede crear productos", Boolean(t.error), t);

console.log("Inventario: traspasos, conteos y compras");
t = await tool(fullKey, "crear_traspaso", { destino: "Bodega", productos: [{ producto: `PER-${stamp}`, cantidad: 2 }], enviar: true, nota: "Para exhibir" });
const tr = t.json;
check("crear_traspaso desde la principal (por SKU) y enviarlo", ok(t) && tr.status === "in_transit" && tr.items[0].cantidad === 2, t.text);
t = await tool(fullKey, "recibir_traspaso", { traspaso: tr?.id });
check("recibir_traspaso completo", ok(t) && t.json.status === "received", t.text);
t = await tool(readKey, "existencias", { texto: `PER-${stamp}` });
check("existencias: el total sigue en 5 (3 en la principal + 2 en la bodega)", ok(t) && JSON.stringify(t.json).includes('"quantity":5'), t.text.slice(0, 300));
t = await tool(readKey, "movimientos_inventario", { producto: `PER-${stamp}`, ubicacion: "Bodega" });
check("movimientos_inventario por SKU y ubicación", ok(t) && JSON.stringify(t.json).includes("transfer"), t.text.slice(0, 300));
t = await tool(fullKey, "crear_conteo", { ubicacion: "Bodega", alcance: "manual", productos: [`PER-${stamp}`] });
const cnt = t.json;
check("crear_conteo manual", ok(t) && cnt.items.length === 1, t.text);
t = await tool(fullKey, "capturar_conteo", { conteo: cnt?.id, conteos: [{ producto: `PER-${stamp}`, cantidad: 1 }] });
check("capturar_conteo por SKU", ok(t), t.text);
t = await tool(fullKey, "terminar_conteo", { conteo: cnt?.id });
check("terminar_conteo ajusta la existencia (2 → 1)", ok(t) && t.json.status === "completed", t.text);
t = await tool(fullKey, "crear_proveedor", { nombre: "Semillas del Norte", correo: "ventas@semillas.example", dias_de_credito: 30 });
check("crear_proveedor", ok(t) && t.json.name === "Semillas del Norte", t.text);
t = await tool(fullKey, "editar_proveedor", { proveedor: "semillas del norte", telefono: "555 123 4567" });
check("editar_proveedor por nombre", ok(t) && t.json.phone === "555 123 4567" && t.json.paymentTermsDays === 30, t.text);
t = await tool(fullKey, "crear_compra", { proveedor: "Semillas del Norte", productos: [{ producto: `JAU-S-${stamp}`, cantidad: 4, costo_unitario_centavos: 20000, impuesto_porcentaje: 16 }], ordenar: true });
const po = t.json;
check("crear_compra y marcarla pedida", ok(t) && po.status === "ordered" && po.items[0].cantidad === 4, t.text);
t = await tool(fullKey, "recibir_compra", { compra: po?.id, recibido: [{ producto: `JAU-S-${stamp}`, cantidad: 3 }], referencia_proveedor: "F-123" });
check("recibir_compra parcial", ok(t) && t.json.status === "partial" && t.json.items[0].recibido === 3, t.text);
t = await tool(fullKey, "recibir_compra", { compra: po?.id });
check("recibir el resto", ok(t) && t.json.status === "received", t.text);
t = await tool(readKey, "listar_compras", { estado: "recibidas" });
check("listar_compras", ok(t) && JSON.stringify(t.json).includes(po?.id), t.text.slice(0, 200));

console.log("Tienda: ajustes, píxeles, promociones y cupones");
t = await tool(fullKey, "editar_ajustes_tienda", { lema: "Aves sanas y sociables", preguntas_frecuentes: [{ pregunta: "¿Hacen envíos?", respuesta: "Sí, a toda la ciudad." }] });
check("editar_ajustes_tienda: lema y preguntas", ok(t) && t.json.lema === "Aves sanas y sociables" && t.json.preguntas_frecuentes.length === 1, t.text);
t = await tool(fullKey, "pixeles", { meta: "123456789012345" });
check("pixeles", ok(t) && t.json.meta === "123456789012345" && t.json.google === null, t.text);
t = await tool(fullKey, "guardar_promocion", { nombre: "Semana de aves", porcentaje: 15, categorias: ["Aves"], canal: "en_linea", hasta: "2099-12-31" });
check("guardar_promocion por categoría (por nombre)", ok(t), t.text);
t = await tool(fullKey, "guardar_promocion", { promocion: "Semana de aves", porcentaje: 20 });
check("editar la promoción por nombre conserva lo demás", ok(t), t.text);
t = await tool(fullKey, "guardar_cupon", { codigo: "aves10", porcentaje: 10, compra_minima_centavos: 50000 });
check("guardar_cupon", ok(t), t.text);
t = await tool(readKey, "listar_promociones");
const promo = t.json?.promotions?.[0];
check("listar_promociones refleja todo", ok(t) && promo.percentBps === 2000 && promo.target === "category" && promo.channel === "online" && t.json.coupons[0].code === "AVES10", t.json ?? t.text);

console.log("Archivar y eliminar");
t = await tool(fullKey, "archivar_producto", { producto: `JAU-S-${stamp}` });
check("archivar_producto", ok(t), t.text);
t = await tool(fullKey, "archivar_producto", { producto: `JAU-S-${stamp}`, restaurar: true });
check("restaurar (lo encuentra aunque esté archivado)", ok(t), t.text);
t = await tool(fullKey, "eliminar_marca", { marca: "Temporal" });
check("eliminar_marca", ok(t), t.text);
t = await tool(fullKey, "eliminar_categoria", { categoria: "Semillas" });
check("eliminar_categoria", ok(t), t.text);
r = await owner("GET", "/api/audit");
const byKey = ((r.data.items ?? r.data) ?? []).filter?.((a) => a.userName === "API · Claude") ?? [];
check("todo queda en la actividad con el nombre de la llave", byKey.length >= 20, byKey.length);

server.close();
console.log(failures ? `\n${failures} fallaron` : "\nTodo bien");
process.exit(failures ? 1 : 0);
