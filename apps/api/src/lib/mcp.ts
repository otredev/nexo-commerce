/**
 * MCP server (Phase 11): lets AI assistants (Claude and others that speak the Model Context Protocol)
 * read and run the business with an API key.
 *
 * Transport: Streamable HTTP, stateless. POST /mcp with one JSON-RPC message (or a batch) answers with
 * JSON; notifications get 202. GET/DELETE answer 405 (no server-initiated stream, no sessions).
 * Auth: "Authorization: Bearer nx_…" (an API key of the business). Each tool calls the same REST API
 * with that key, so permissions, read-only keys, validation and audit work exactly as for any client.
 */
import type { Context } from "hono";
import {
  ANNOUNCEMENT_TONES, BLOCK_TYPE_IDS, BLOCK_TYPES, blockSummary, can, CODE_LIMITS, MOVEMENT_REASONS, PAYMENT_CODES, resolveTheme, THEME_FONT_IDS, THEME_FONTS, THEME_PRESET_IDS,
  THEME_PRESETS, THEME_RADIUS_IDS, themeWarnings, type BlockType, type Permission, type StoreAppearance, type StoreAppearanceSettings, type StoreBlock,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { bearerKey, loadApiKey, type KeySession } from "./apiKeys";
import { COLOR, DATE, DATE_OR_NULL, json200, LINK, obj, optStr, qs, str, type Args, type Call, type Tool } from "./mcpKit";
import { CATALOG_TOOLS } from "./mcpCatalog";
import { INVENTORY_TOOLS } from "./mcpInventory";
import { STORE_TOOLS } from "./mcpStore";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "nexo", title: "Nexo", version: "1.0.0" };
const INSTRUCTIONS =
  "Herramientas de Nexo para el negocio conectado: catálogo (productos, variantes, categorías, marcas, impuestos e imágenes), existencias, traspasos, conteos, proveedores y compras, ventas, reportes, pedidos de la tienda en línea, clientes, promociones y cupones, y la tienda en línea (ajustes, tema, avisos, secciones de la página principal, píxeles y CSS). " +
  "Productos, categorías, marcas, ubicaciones y proveedores se pueden indicar por nombre o SKU además de por id. " +
  "Las cantidades de dinero vienen en centavos (…Cents): divide entre 100. Las fechas son AAAA-MM-DD en la zona horaria del negocio. " +
  "Antes de cambiar algo, confirma con la persona lo que vas a hacer; antes de eliminar o cancelar, pide confirmación explícita. Para el CSS o el HTML de una sección, muéstrale exactamente lo que vas a guardar.";

const REASONS = [...MOVEMENT_REASONS.in, ...MOVEMENT_REASONS.out, ...MOVEMENT_REASONS.set].map((r) => r.code);
const STATUS_MAP: Record<string, string> = { abiertos: "open", nuevos: "pending", aceptados: "confirmed", listos: "ready", entregados: "completed", cancelados: "cancelled", todos: "all" };
const STOCK_MAP: Record<string, string> = { todas: "all", pocas: "low", agotadas: "out" };


/* ---------- Store appearance (Phase 11+): read, change and save the whole document ---------- */

const APPEARANCE = "/api/store-settings/appearance";

/** Reads the appearance, lets `change` edit it, saves it (the API validates and checks the plan). */
async function updateAppearance(call: Call, change: (a: StoreAppearance) => string | null, summary: (s: StoreAppearanceSettings) => unknown) {
  const res = await call("GET", APPEARANCE);
  if (!res.ok) return res;
  const cur = (await res.json()) as StoreAppearanceSettings;
  const next: StoreAppearance = structuredClone({ theme: cur.theme, announcement: cur.announcement, blocks: cur.blocks, pixels: cur.pixels, code: cur.code });
  const problem = change(next);
  if (problem) return new Response(JSON.stringify({ error: { message: problem } }), { status: 422, headers: { "content-type": "application/json" } });
  const saved = await call("PUT", APPEARANCE, next);
  if (!saved.ok) return saved;
  return json200(summary((await saved.json()) as StoreAppearanceSettings));
}

const themeSummary = (s: StoreAppearanceSettings) => {
  const r = resolveTheme(s.theme);
  return {
    estilo: s.theme.preset, colores: { principal: r.primary, fondo: r.background, texto: r.text }, letra: r.font, esquinas: r.radius,
    modo: r.scheme === "auto" ? "sigue el modo claro/oscuro del cliente" : r.scheme === "dark" ? "oscuro" : "claro",
    avisos: themeWarnings(r),
  };
};
const announcementSummary = (s: StoreAppearanceSettings) => s.announcement;
const sectionsSummary = (s: Pick<StoreAppearanceSettings, "blocks">) => s.blocks.map((b, i) => ({
  posicion: i + 1, id: b.id, tipo: b.type, tipo_nombre: BLOCK_TYPES[b.type].label, nombre: b.name, visible: b.enabled, resumen: blockSummary(b),
  dispositivo: b.device, ancla: b.anchor, desde: b.startsOn, hasta: b.endsOn,
}));
const codeSummary = (s: StoreAppearanceSettings) => ({
  css: s.code.css,
  limite: CODE_LIMITS.css,
  nota: "El CSS se aplica en todas las páginas de la tienda. El HTML y JavaScript propios van en secciones «HTML personalizado» (marco aislado), con agregar_seccion o editar_seccion.",
});

/** A section by its id or its position (1 = the first). */
function findBlock(blocks: StoreBlock[], key: unknown) {
  const i = typeof key === "number" || /^\d+$/.test(String(key)) ? Number(key) - 1 : blocks.findIndex((b) => b.id === key);
  return blocks[i] ? i : -1;
}
const notFoundBlock = (key: unknown, blocks: StoreBlock[]) => `No hay una sección «${String(key)}». La página tiene ${blocks.length} ${blocks.length === 1 ? "sección" : "secciones"} (ver_apariencia).`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SECTION_FIELDS = {
  datos: { type: "object", description: "Contenido de la sección (campos según el tipo; ver ver_seccion). Solo cambia los campos que mandes; las listas se reemplazan completas." },
  estilo: { type: "object", description: "Diseño: background, text, accent (#RRGGBB o null = del tema), backgroundImage, overlay (0–90), font, radius, paddingTop/paddingBottom (none, sm, md, lg, xl), width (narrow, normal, wide, full), align (left, center, right), frame (none, card, outline), edgeTop/edgeBottom (none, slant, curve, wave, zigzag)." },
  nombre: { type: ["string", "null"], maxLength: 60, description: "Nombre en el editor" },
  visible: { type: "boolean" },
  dispositivo: { type: "string", enum: ["all", "desktop", "mobile"], description: "all = siempre, desktop = solo computadora, mobile = solo celular" },
  ancla: { type: ["string", "null"], description: "id para enlazar con #ancla desde el menú (minúsculas, números y guiones)" },
};


export const MCP_TOOLS: Tool[] = [
  {
    name: "resumen_de_hoy", title: "Resumen de hoy", permission: "sales:read",
    description: "Ventas de hoy (caja y en línea), comparación con ayer, últimos 7 días, productos más vendidos de la semana, cajas abiertas y pedidos pendientes.",
    inputSchema: obj({}),
    run: (_a, call) => call("GET", "/api/reports/dashboard"),
  },
  {
    name: "buscar_productos", title: "Buscar productos", permission: "catalog:read",
    description: "Busca productos por nombre, SKU o código de barras. Devuelve precio, existencias y variantes (20 por página).",
    inputSchema: obj({
      texto: { type: "string", description: "Nombre, SKU o código. Vacío = todos." },
      existencias: { type: "string", enum: Object.keys(STOCK_MAP), description: "Filtrar por existencias" },
      pagina: { type: "integer", minimum: 1 },
    }),
    run: (a, call) => call("GET", `/api/products${qs({ q: str(a.texto), stock: STOCK_MAP[str(a.existencias)], page: a.pagina, pageSize: 20 })}`),
  },
  {
    name: "ver_producto", title: "Ver producto", permission: "catalog:read",
    description: "Detalle de un producto por id: variantes, precios, existencias por ubicación, categoría y marca.",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
    run: (a, call) => call("GET", `/api/products/${encodeURIComponent(str(a.id))}`),
  },
  {
    name: "ubicaciones", title: "Ubicaciones", permission: "settings:read",
    description: "Tiendas, sucursales y bodegas del negocio, con su id (para existencias y ajustes).",
    inputSchema: obj({}),
    run: (_a, call) => call("GET", "/api/locations"),
  },
  {
    name: "existencias", title: "Existencias", permission: "inventory:read",
    description: "Existencias por variante, de todas las ubicaciones o de una. Útil para saber qué resurtir (filtro «pocas» o «agotadas»).",
    inputSchema: obj({
      texto: { type: "string" },
      filtro: { type: "string", enum: Object.keys(STOCK_MAP) },
      ubicacion_id: { type: "string" },
      pagina: { type: "integer", minimum: 1 },
    }),
    run: (a, call) => call("GET", `/api/inventory${qs({ q: str(a.texto), stock: STOCK_MAP[str(a.filtro)], locationId: str(a.ubicacion_id), page: a.pagina, pageSize: 50 })}`),
  },
  {
    name: "ajustar_existencias", title: "Ajustar existencias", permission: "inventory:write", write: true,
    description: "Registra una entrada, salida o conteo físico de una variante en una ubicación (queda en el Kardex). Motivos: entrada → purchase, customer_return, found, other_in; salida → damage, expired, loss, internal_use, supplier_return, other_out; conteo → count.",
    inputSchema: obj({
      variante_id: { type: "string" },
      ubicacion_id: { type: "string" },
      tipo: { type: "string", enum: ["entrada", "salida", "conteo"] },
      cantidad: { type: "number", exclusiveMinimum: 0, description: "Para conteo: la cantidad contada (puede ser 0)." },
      motivo: { type: "string", enum: REASONS },
      nota: { type: "string", maxLength: 300 },
    }, ["variante_id", "ubicacion_id", "tipo", "cantidad", "motivo"]),
    run: (a, call) => call("POST", "/api/inventory/movements", {
      variantId: str(a.variante_id), locationId: str(a.ubicacion_id), type: ({ entrada: "in", salida: "out", conteo: "set" } as Record<string, string>)[str(a.tipo)] ?? str(a.tipo),
      quantity: a.cantidad, reason: str(a.motivo), note: str(a.nota) || null,
    }),
  },
  {
    name: "reporte_de_ventas", title: "Reporte de ventas", permission: "reports:read",
    description: "Ventas de un periodo: totales, utilidad, descuentos, ventas por día, por categoría, por producto, formas de pago y cajeros, comparadas con el periodo anterior.",
    inputSchema: obj({ desde: DATE, hasta: DATE }, ["desde", "hasta"]),
    run: (a, call) => call("GET", `/api/reports/sales${qs({ from: str(a.desde), to: str(a.hasta) })}`),
  },
  {
    name: "estadisticas_tienda", title: "Estadísticas de la tienda en línea", permission: "reports:read",
    description: "Visitantes, conversión, embudo de compra, fuentes, campañas, dispositivos y productos más vistos y vendidos de la tienda en línea (hasta 90 días).",
    inputSchema: obj({ desde: DATE, hasta: DATE }, ["desde", "hasta"]),
    run: (a, call) => call("GET", `/api/reports/store${qs({ from: str(a.desde), to: str(a.hasta) })}`),
  },
  {
    name: "listar_pedidos", title: "Pedidos en línea", permission: "orders:read",
    description: "Pedidos de la tienda en línea. Por defecto los abiertos (nuevos, aceptados y listos).",
    inputSchema: obj({
      estado: { type: "string", enum: Object.keys(STATUS_MAP) },
      texto: { type: "string", description: "Número de pedido, nombre, correo o teléfono del cliente" },
      pagina: { type: "integer", minimum: 1 },
    }),
    run: (a, call) => call("GET", `/api/orders${qs({ status: STATUS_MAP[str(a.estado)] ?? "open", q: str(a.texto), page: a.pagina, pageSize: 25 })}`),
  },
  {
    name: "ver_pedido", title: "Ver pedido", permission: "orders:read",
    description: "Detalle de un pedido por id: productos, cliente, entrega, pago e historial.",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
    run: (a, call) => call("GET", `/api/orders/${encodeURIComponent(str(a.id))}`),
  },
  {
    name: "avanzar_pedido", title: "Avanzar pedido", permission: "orders:fulfill", write: true,
    description: "Cambia el estado de un pedido: «aceptar» (en preparación), «listo» (para recoger o en camino) o «entregar». Para entregar uno sin pagar, indica metodo_pago. El cliente recibe un correo.",
    inputSchema: obj({
      id: { type: "string" },
      accion: { type: "string", enum: ["aceptar", "listo", "entregar"] },
      metodo_pago: { type: "string", enum: [...PAYMENT_CODES], description: "Solo al entregar un pedido sin pagar" },
      referencia_pago: { type: "string", maxLength: 80 },
    }, ["id", "accion"]),
    run: (a, call) => {
      const id = encodeURIComponent(str(a.id));
      const action = str(a.accion);
      if (action === "aceptar") return call("POST", `/api/orders/${id}/confirm`);
      if (action === "listo") return call("POST", `/api/orders/${id}/ready`);
      return call("POST", `/api/orders/${id}/complete`, { payment: a.metodo_pago ? { method: a.metodo_pago, reference: str(a.referencia_pago) || null } : null });
    },
  },
  {
    name: "buscar_clientes", title: "Buscar clientes", permission: "customers:read",
    description: "Busca clientes por nombre, teléfono o correo, con sus compras.",
    inputSchema: obj({ texto: { type: "string" }, pagina: { type: "integer", minimum: 1 } }),
    run: (a, call) => call("GET", `/api/customers${qs({ q: str(a.texto), page: a.pagina, pageSize: 25 })}`),
  },
  {
    name: "ver_apariencia", title: "Ver la apariencia de la tienda", permission: "settings:read",
    description: "Tema (estilo, colores, letra, esquinas), barra de avisos y las secciones de la página principal en orden (portada, banners, catálogo, galería, horarios, mapa, HTML…), más los tipos de sección, estilos y letras disponibles. El detalle de una sección se ve con ver_seccion y el CSS con ver_codigo_tienda.",
    inputSchema: obj({}),
    run: async (_a, call) => {
      const res = await call("GET", APPEARANCE);
      if (!res.ok) return res;
      const s = (await res.json()) as StoreAppearanceSettings;
      return json200({
        tema: themeSummary(s), barra_de_avisos: announcementSummary(s), secciones: sectionsSummary(s),
        tipos_de_seccion: BLOCK_TYPE_IDS.map((id) => ({ tipo: id, nombre: BLOCK_TYPES[id].label, descripcion: BLOCK_TYPES[id].description, solo_una: BLOCK_TYPES[id].single })),
        estilos_disponibles: THEME_PRESET_IDS.map((id) => ({ id, nombre: THEME_PRESETS[id].label, descripcion: THEME_PRESETS[id].description })),
        letras_disponibles: THEME_FONT_IDS.map((id) => ({ id, nombre: THEME_FONTS[id].label, uso: THEME_FONTS[id].hint })),
        esquinas_disponibles: THEME_RADIUS_IDS, colores_de_barra: Object.keys(ANNOUNCEMENT_TONES),
        css_caracteres: s.code.css.length,
      });
    },
  },
  {
    name: "cambiar_tema", title: "Cambiar el tema de la tienda", permission: "store:write", write: true,
    description: "Cambia el estilo, los colores, la letra de los títulos o las esquinas de la tienda en línea. Solo cambia lo que mandes. Cambiar de estilo sin colores vuelve a los colores de ese estilo. Responde avisos si algún color se lee mal.",
    inputSchema: obj({
      estilo: { type: "string", enum: [...THEME_PRESET_IDS] },
      color_principal: COLOR,
      color_fondo: COLOR,
      color_texto: COLOR,
      letra: { type: ["string", "null"], enum: [...THEME_FONT_IDS, null] },
      esquinas: { type: ["string", "null"], enum: [...THEME_RADIUS_IDS, null] },
    }),
    run: (a, call) => updateAppearance(call, (n) => {
      if (a.estilo !== undefined) n.theme = { preset: a.estilo as StoreAppearance["theme"]["preset"], primary: null, background: null, text: null, font: null, radius: null };
      if (a.color_principal !== undefined) n.theme.primary = optStr(a.color_principal) ?? null;
      if (a.color_fondo !== undefined) n.theme.background = optStr(a.color_fondo) ?? null;
      if (a.color_texto !== undefined) n.theme.text = optStr(a.color_texto) ?? null;
      if (a.letra !== undefined) n.theme.font = (optStr(a.letra) ?? null) as StoreAppearance["theme"]["font"];
      if (a.esquinas !== undefined) n.theme.radius = (optStr(a.esquinas) ?? null) as StoreAppearance["theme"]["radius"];
      return null;
    }, themeSummary),
  },
  {
    name: "barra_de_avisos", title: "Barra de avisos de la tienda", permission: "store:write", write: true,
    description: "Activa, desactiva o cambia la franja de avisos arriba de la tienda: hasta 3 mensajes que se alternan (máx. 140 caracteres cada uno), color, si el cliente puede cerrarla y fechas. Solo cambia lo que mandes; «mensajes» reemplaza todos los mensajes.",
    inputSchema: obj({
      activa: { type: "boolean" },
      mensajes: { type: "array", minItems: 1, maxItems: 3, items: obj({ texto: { type: "string", maxLength: 140 }, enlace: LINK }, ["texto"]) },
      color: { type: "string", enum: Object.keys(ANNOUNCEMENT_TONES), description: "primary = color principal, ink = oscuro, accent = suave, warning = aviso" },
      se_puede_cerrar: { type: "boolean" },
      desde: DATE_OR_NULL,
      hasta: DATE_OR_NULL,
    }),
    run: (a, call) => updateAppearance(call, (n) => {
      const ann = n.announcement;
      if (a.activa !== undefined) ann.enabled = Boolean(a.activa);
      if (Array.isArray(a.mensajes)) ann.messages = (a.mensajes as Array<{ texto?: unknown; enlace?: unknown }>).map((m) => ({ text: String(m.texto ?? "").trim(), link: optStr(m.enlace) ?? null }));
      if (a.color !== undefined) ann.tone = a.color as StoreAppearance["announcement"]["tone"];
      if (a.se_puede_cerrar !== undefined) ann.dismissible = Boolean(a.se_puede_cerrar);
      if (a.desde !== undefined) ann.startsOn = optStr(a.desde) ?? null;
      if (a.hasta !== undefined) ann.endsOn = optStr(a.hasta) ?? null;
      return null;
    }, announcementSummary),
  },
  {
    name: "pixeles", title: "Píxeles de anuncios", permission: "store:write", write: true,
    description: "Configura los píxeles de Meta (Facebook e Instagram), Google (GA4 G-…, Ads AW-… o Tag Manager GTM-…) y TikTok. La tienda pide permiso de cookies al cliente antes de activarlos. Solo cambia lo que mandes; null quita uno.",
    inputSchema: obj({ meta: { type: ["string", "null"], description: "ID del conjunto de datos (solo números)" }, google: { type: ["string", "null"] }, tiktok: { type: ["string", "null"] } }),
    run: (a, call) => updateAppearance(call, (n) => {
      if (a.meta !== undefined) n.pixels.metaPixelId = optStr(a.meta) ?? null;
      if (a.google !== undefined) n.pixels.googleTagId = optStr(a.google) ?? null;
      if (a.tiktok !== undefined) n.pixels.tiktokPixelId = optStr(a.tiktok) ?? null;
      return null;
    }, (s) => ({ meta: s.pixels.metaPixelId, google: s.pixels.googleTagId, tiktok: s.pixels.tiktokPixelId })),
  },
  {
    name: "ver_seccion", title: "Ver una sección de la página principal", permission: "settings:read",
    description: "Todo el contenido (datos) y el diseño (estilo) de una sección, por su id o su posición. Úsalo antes de editar_seccion para ver los campos de ese tipo.",
    inputSchema: obj({ seccion: { type: ["string", "integer"], description: "id de la sección o su posición (1 = la primera)" } }, ["seccion"]),
    run: async (a, call) => {
      const res = await call("GET", APPEARANCE);
      if (!res.ok) return res;
      const s = (await res.json()) as StoreAppearanceSettings;
      const i = findBlock(s.blocks, a.seccion);
      if (i < 0) return new Response(JSON.stringify({ error: { message: notFoundBlock(a.seccion, s.blocks) } }), { status: 404, headers: { "content-type": "application/json" } });
      return json200({ posicion: i + 1, tipo_nombre: BLOCK_TYPES[s.blocks[i]!.type].label, ...s.blocks[i] });
    },
  },
  {
    name: "agregar_seccion", title: "Agregar una sección a la página principal", permission: "store:write", write: true,
    description: "Agrega una sección del tipo indicado (ver tipos_de_seccion en ver_apariencia), al final o en una posición. Lo que no mandes toma su valor por defecto. Las imágenes nuevas se suben desde el panel. Para «html», el HTML corre en un marco aislado (sandbox, sin acceso a la tienda): muestra el código a la persona antes de guardarlo.",
    inputSchema: obj({ tipo: { type: "string", enum: [...BLOCK_TYPE_IDS] }, posicion: { type: "integer", minimum: 1, description: "1 = arriba de todo. Sin posición, al final." }, ...SECTION_FIELDS }, ["tipo"]),
    run: (a, call) => updateAppearance(call, (n) => {
      const type = str(a.tipo) as BlockType;
      if (!BLOCK_TYPE_IDS.includes(type)) return `Tipo de sección desconocido: ${String(a.tipo)}.`;
      if (BLOCK_TYPES[type].single && n.blocks.some((b) => b.type === type)) return `Ya hay una sección «${BLOCK_TYPES[type].label}»; solo puede haber una. Edítala con editar_seccion.`;
      const block = { id: `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`, type, enabled: a.visible === undefined ? true : Boolean(a.visible), name: optStr(a.nombre) ?? null, device: a.dispositivo ?? "all", anchor: optStr(a.ancla) ?? null, data: isObj(a.datos) ? a.datos : {}, style: isObj(a.estilo) ? a.estilo : {} } as unknown as StoreBlock;
      const at = typeof a.posicion === "number" ? Math.min(Math.max(1, a.posicion), n.blocks.length + 1) - 1 : n.blocks.length;
      n.blocks.splice(at, 0, block);
      return null;
    }, sectionsSummary),
  },
  {
    name: "editar_seccion", title: "Editar una sección de la página principal", permission: "store:write", write: true,
    description: "Cambia una sección por su id o posición: contenido (datos), diseño (estilo), mostrarla u ocultarla, nombre, dispositivo, ancla y fechas. Solo cambia lo que mandes. Lee la sección con ver_seccion antes. Para el HTML de una sección «html», muestra el código a la persona antes de guardarlo.",
    inputSchema: obj({ seccion: { type: ["string", "integer"], description: "id de la sección o su posición (1 = la primera)" }, ...SECTION_FIELDS, desde: DATE_OR_NULL, hasta: DATE_OR_NULL }, ["seccion"]),
    run: (a, call) => updateAppearance(call, (n) => {
      const i = findBlock(n.blocks, a.seccion);
      if (i < 0) return notFoundBlock(a.seccion, n.blocks);
      const b = n.blocks[i]! as StoreBlock & { data: Record<string, unknown>; style: Record<string, unknown> };
      if (a.datos !== undefined) { if (!isObj(a.datos)) return "«datos» debe ser un objeto."; b.data = { ...b.data, ...a.datos }; }
      if (a.estilo !== undefined) { if (!isObj(a.estilo)) return "«estilo» debe ser un objeto."; b.style = { ...b.style, ...a.estilo }; }
      if (a.visible !== undefined) b.enabled = Boolean(a.visible);
      if (a.nombre !== undefined) b.name = optStr(a.nombre) ?? null;
      if (a.dispositivo !== undefined) b.device = a.dispositivo as StoreBlock["device"];
      if (a.ancla !== undefined) b.anchor = optStr(a.ancla) ?? null;
      if (a.desde !== undefined) b.startsOn = optStr(a.desde) ?? null;
      if (a.hasta !== undefined) b.endsOn = optStr(a.hasta) ?? null;
      return null;
    }, sectionsSummary),
  },
  {
    name: "ordenar_secciones", title: "Ordenar o quitar secciones", permission: "store:write", write: true,
    description: "Define el orden de las secciones de la página principal con la lista de sus ids. Las que no pongas se eliminan (pide confirmación antes de quitar alguna; para esconderla sin borrarla usa editar_seccion con visible: false).",
    inputSchema: obj({ orden: { type: "array", items: { type: "string" }, maxItems: 40, description: "ids en el orden deseado" } }, ["orden"]),
    run: (a, call) => updateAppearance(call, (n) => {
      const ids = (a.orden as unknown[]).map(String);
      const unknown = ids.filter((id) => !n.blocks.some((b) => b.id === id));
      if (unknown.length) return `Secciones que no existen: ${unknown.join(", ")}.`;
      if (new Set(ids).size !== ids.length) return "Hay ids repetidos.";
      n.blocks = ids.map((id) => n.blocks.find((b) => b.id === id)!);
      return null;
    }, sectionsSummary),
  },
  {
    name: "ver_codigo_tienda", title: "Ver el CSS personalizado de la tienda", permission: "settings:read",
    description: "El CSS personalizado de la tienda y su límite. Se aplica en todas las páginas, después del tema.",
    inputSchema: obj({}),
    run: async (_a, call) => {
      const res = await call("GET", APPEARANCE);
      return res.ok ? json200(codeSummary((await res.json()) as StoreAppearanceSettings)) : res;
    },
  },
  {
    name: "editar_codigo_tienda", title: "Editar el CSS personalizado de la tienda", permission: "store:write", write: true, destructive: true,
    description: "Reemplaza el CSS personalizado de la tienda (\"\" lo borra). Aplica en todas las páginas: un error puede descomponer el diseño. Muestra el CSS a la persona y pide confirmación antes de guardarlo. Lee el actual con ver_codigo_tienda antes de editar.",
    inputSchema: obj({ css: { type: "string", maxLength: CODE_LIMITS.css } }, ["css"]),
    run: (a, call) => updateAppearance(call, (n) => {
      n.code.css = String(a.css ?? "");
      return null;
    }, codeSummary),
  },
  ...CATALOG_TOOLS,
  ...INVENTORY_TOOLS,
  ...STORE_TOOLS,
];

/** Tools this key may use: role permission, and no writes for read-only keys. */
export const toolsFor = (key: KeySession) => MCP_TOOLS.filter((t) => can(key.role, t.permission) && !(t.write && key.apiKey.readOnly));

type RpcId = string | number | null;
interface RpcRequest { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> }
const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const MAX_TEXT = 60_000;

async function handleOne(msg: RpcRequest, key: KeySession, call: Call): Promise<object | null> {
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isNotification ? null : rpcError(msg.id ?? null, -32600, "Invalid Request");
  if (isNotification) return null;
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0", id,
        result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: `${INSTRUCTIONS} Negocio: ${key.tenant.name}.` },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0", id,
        result: {
          tools: toolsFor(key).map((t) => ({
            name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
            annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: Boolean(t.destructive), idempotentHint: !t.write, openWorldHint: false },
          })),
        },
      };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = toolsFor(key).find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Herramienta desconocida o no permitida para esta llave: ${name}`);
      const args = (msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {}) as Args;
      for (const r of (tool.inputSchema.required as string[]) ?? []) {
        if (args[r] === undefined || args[r] === "") return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Falta el dato «${r}».` }], isError: true } };
      }
      const res = await tool.run(args, call);
      const text = await res.text();
      if (!res.ok) {
        let message = text;
        try {
          const e = (JSON.parse(text) as { error?: { message?: string; fields?: Record<string, string> } }).error;
          message = [e?.message, ...Object.entries(e?.fields ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(" · ");
        } catch { /* plain text */ }
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error ${res.status}: ${message}` }], isError: true } };
      }
      const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (recortado: pide menos resultados o la siguiente página)` : text || "Listo.";
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: body }], isError: false } };
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** POST /mcp (and 405 for GET/DELETE). */
export async function handleMcp(c: Context<AppEnv>, call: (token: string) => Call) {
  if (c.req.method !== "POST") return c.body(null, 405, { Allow: "POST" });
  // DNS-rebinding protection: browsers send Origin; only our own app may call from a page.
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.env.APP_URL).origin && origin !== new URL(c.req.url).origin) return c.json(rpcError(null, -32000, "Origin not allowed"), 403);
  const token = bearerKey(c);
  const key = token ? await loadApiKey(c, token) : null;
  if (!key) {
    return c.json(rpcError(null, -32001, "Falta una llave de API válida (Authorization: Bearer nx_…). Créala en Configuración › Integraciones."), 401, {
      "WWW-Authenticate": 'Bearer realm="nexo", error="invalid_token"',
    });
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json(rpcError(null, -32700, "Parse error"), 400); }
  const caller = call(token!);
  if (Array.isArray(body)) {
    if (!body.length) return c.json(rpcError(null, -32600, "Invalid Request"), 400);
    const out = (await Promise.all(body.map((m) => handleOne(m as RpcRequest, key, caller)))).filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const out = await handleOne(body as RpcRequest, key, caller);
  return out ? c.json(out) : c.body(null, 202);
}
