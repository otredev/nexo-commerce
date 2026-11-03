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
  ANNOUNCEMENT_TONES, can, CODE_LIMITS, MOVEMENT_REASONS, PAYMENT_CODES, resolveTheme, THEME_FONT_IDS, THEME_FONTS, THEME_PRESET_IDS, THEME_PRESETS, THEME_RADIUS_IDS,
  themeWarnings, type Permission, type StoreAppearance, type StoreAppearanceSettings,
} from "@nexo/shared";
import type { AppEnv } from "../env";
import { bearerKey, loadApiKey, type KeySession } from "./apiKeys";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "nexo", title: "Nexo", version: "1.0.0" };
const INSTRUCTIONS =
  "Herramientas de Nexo para el negocio conectado: catálogo, existencias, ventas, reportes, pedidos de la tienda en línea, clientes y la apariencia de la tienda (tema, avisos, banners y código). " +
  "Las cantidades de dinero vienen en centavos (…Cents): divide entre 100. Las fechas son AAAA-MM-DD en la zona horaria del negocio. " +
  "Antes de cambiar algo (existencias, pedidos, apariencia o código de la tienda), confirma con la persona; para el código, muéstrale exactamente lo que vas a guardar.";

type Call = (method: "GET" | "POST" | "PUT", path: string, body?: unknown) => Promise<Response>;
type Args = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  permission: Permission;
  write?: boolean;
  /** Can break what customers see (custom HTML/JS): clients should ask before running it. */
  destructive?: boolean;
  inputSchema: JsonSchema;
  run: (args: Args, call: Call) => Promise<Response>;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "AAAA-MM-DD" };
const obj = (properties: Record<string, JsonSchema>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const REASONS = [...MOVEMENT_REASONS.in, ...MOVEMENT_REASONS.out, ...MOVEMENT_REASONS.set].map((r) => r.code);
const STATUS_MAP: Record<string, string> = { abiertos: "open", nuevos: "pending", aceptados: "confirmed", listos: "ready", entregados: "completed", cancelados: "cancelled", todos: "all" };
const STOCK_MAP: Record<string, string> = { todas: "all", pocas: "low", agotadas: "out" };


/* ---------- Store appearance (Phase 11+): read, change and save the whole document ---------- */

const json200 = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
const APPEARANCE = "/api/store-settings/appearance";

/** Reads the appearance, lets `change` edit it, saves it (the API validates and checks the plan). */
async function updateAppearance(call: Call, change: (a: StoreAppearance) => string | null, summary: (s: StoreAppearanceSettings) => unknown) {
  const res = await call("GET", APPEARANCE);
  if (!res.ok) return res;
  const cur = (await res.json()) as StoreAppearanceSettings;
  const next: StoreAppearance = structuredClone({ theme: cur.theme, announcement: cur.announcement, banners: cur.banners, pixels: cur.pixels, code: cur.code });
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
const bannersSummary = (s: StoreAppearanceSettings) => s.banners.map((b, i) => ({ posicion: i + 1, id: b.id, visible: b.enabled, titulo: b.heading, texto: b.text, boton: b.cta, enlace: b.link, color_texto: b.textColor, alineacion: b.align, desde: b.startsOn, hasta: b.endsOn, imagen: b.image, imagen_celular: b.imageMobile }));
const codeSummary = (s: StoreAppearanceSettings) => ({
  css: s.code.css, html_head: s.code.headHtml, html_body: s.code.bodyHtml, javascript: s.code.js,
  limites: { css: CODE_LIMITS.css, html_head: CODE_LIMITS.headHtml, html_body: CODE_LIMITS.bodyHtml, javascript: CODE_LIMITS.js },
  html_y_js_permitidos: s.codeAllowed,
  donde_se_ejecutan_html_y_js: s.domain ? `Solo en el dominio propio ${s.domain}, excepto en el pago y el seguimiento del pedido.` : "En ningún lado todavía: el HTML y el JavaScript solo corren cuando la tienda abre en su dominio propio. El CSS sí se aplica en todas las páginas.",
});

const optStr = (v: unknown) => (v === undefined ? undefined : v === null || v === "" ? null : String(v).trim());
const DATE_OR_NULL = { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "AAAA-MM-DD, o null para quitar la fecha" };
const LINK = { type: ["string", "null"], description: "Ruta de la tienda (/p/<id>, ?categoria=<id>, ?orden=new) o una dirección https://. null para quitarlo." };
const COLOR = { type: ["string", "null"], pattern: "^#[0-9a-fA-F]{6}$", description: "#RRGGBB, o null para volver al color del estilo" };

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
    description: "Tema (estilo, colores, letra, esquinas), barra de avisos y banners de la tienda en línea, más los estilos y letras disponibles. El código personalizado se ve con ver_codigo_tienda.",
    inputSchema: obj({}),
    run: async (_a, call) => {
      const res = await call("GET", APPEARANCE);
      if (!res.ok) return res;
      const s = (await res.json()) as StoreAppearanceSettings;
      return json200({
        tema: themeSummary(s), barra_de_avisos: announcementSummary(s), banners: bannersSummary(s),
        estilos_disponibles: THEME_PRESET_IDS.map((id) => ({ id, nombre: THEME_PRESETS[id].label, descripcion: THEME_PRESETS[id].description })),
        letras_disponibles: THEME_FONT_IDS.map((id) => ({ id, nombre: THEME_FONTS[id].label, uso: THEME_FONTS[id].hint })),
        esquinas_disponibles: THEME_RADIUS_IDS, colores_de_barra: Object.keys(ANNOUNCEMENT_TONES),
        codigo_personalizado: { caracteres: { css: s.code.css.length, html_head: s.code.headHtml.length, html_body: s.code.bodyHtml.length, javascript: s.code.js.length } },
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
    name: "editar_banner", title: "Editar un banner de la tienda", permission: "store:write", write: true,
    description: "Cambia un banner que ya existe (por su id o su posición, ver ver_apariencia): mostrarlo u ocultarlo, título, texto, botón, enlace, color del texto, alineación y fechas. Solo cambia lo que mandes. Las imágenes nuevas se suben desde el panel.",
    inputSchema: obj({
      banner: { type: ["string", "integer"], description: "id del banner o su posición (1 = el primero)" },
      visible: { type: "boolean" },
      titulo: { type: ["string", "null"], maxLength: 80 },
      texto: { type: ["string", "null"], maxLength: 160 },
      boton: { type: ["string", "null"], maxLength: 30, description: "Texto del botón; necesita enlace" },
      enlace: LINK,
      color_texto: { type: "string", enum: ["light", "dark"], description: "light = texto blanco sobre la imagen, dark = texto oscuro" },
      alineacion: { type: "string", enum: ["left", "center"] },
      desde: DATE_OR_NULL,
      hasta: DATE_OR_NULL,
    }, ["banner"]),
    run: (a, call) => updateAppearance(call, (n) => {
      const key = a.banner;
      const i = typeof key === "number" || /^\d+$/.test(String(key)) ? Number(key) - 1 : n.banners.findIndex((b) => b.id === key);
      const b = n.banners[i];
      if (!b) return `No hay un banner «${String(key)}». La tienda tiene ${n.banners.length} ${n.banners.length === 1 ? "banner" : "banners"}.`;
      if (a.visible !== undefined) b.enabled = Boolean(a.visible);
      if (a.titulo !== undefined) b.heading = optStr(a.titulo) ?? null;
      if (a.texto !== undefined) b.text = optStr(a.texto) ?? null;
      if (a.boton !== undefined) b.cta = optStr(a.boton) ?? null;
      if (a.enlace !== undefined) b.link = optStr(a.enlace) ?? null;
      if (a.color_texto !== undefined) b.textColor = a.color_texto as "light" | "dark";
      if (a.alineacion !== undefined) b.align = a.alineacion as "left" | "center";
      if (a.desde !== undefined) b.startsOn = optStr(a.desde) ?? null;
      if (a.hasta !== undefined) b.endsOn = optStr(a.hasta) ?? null;
      return null;
    }, bannersSummary),
  },
  {
    name: "ordenar_banners", title: "Ordenar o quitar banners", permission: "store:write", write: true,
    description: "Define el orden de los banners con la lista de sus ids. Los ids que no pongas se eliminan de la tienda (pide confirmación antes de quitar alguno).",
    inputSchema: obj({ orden: { type: "array", items: { type: "string" }, maxItems: 6, description: "ids en el orden deseado" } }, ["orden"]),
    run: (a, call) => updateAppearance(call, (n) => {
      const ids = (a.orden as unknown[]).map(String);
      const unknown = ids.filter((id) => !n.banners.some((b) => b.id === id));
      if (unknown.length) return `Banners que no existen: ${unknown.join(", ")}.`;
      n.banners = ids.map((id) => n.banners.find((b) => b.id === id)!);
      return null;
    }, bannersSummary),
  },
  {
    name: "ver_codigo_tienda", title: "Ver el código personalizado de la tienda", permission: "settings:read",
    description: "CSS, HTML (antes de </head> y antes de </body>) y JavaScript personalizados de la tienda, con sus límites y dónde se ejecutan.",
    inputSchema: obj({}),
    run: async (_a, call) => {
      const res = await call("GET", APPEARANCE);
      return res.ok ? json200(codeSummary((await res.json()) as StoreAppearanceSettings)) : res;
    },
  },
  {
    name: "editar_codigo_tienda", title: "Editar el código personalizado de la tienda", permission: "store:write", write: true, destructive: true,
    description: "Reemplaza el CSS, el HTML de <head>, el HTML del final de <body> o el JavaScript de la tienda (cada campo que mandes sustituye al actual; \"\" lo borra). El CSS aplica en todas las páginas; HTML y JavaScript requieren plan Pro y solo corren en el dominio propio. Un error puede romper la tienda: muestra el código a la persona y pide confirmación antes de guardarlo. Lee el actual con ver_codigo_tienda antes de editar.",
    inputSchema: obj({
      css: { type: "string", maxLength: CODE_LIMITS.css },
      html_head: { type: "string", maxLength: CODE_LIMITS.headHtml },
      html_body: { type: "string", maxLength: CODE_LIMITS.bodyHtml },
      javascript: { type: "string", maxLength: CODE_LIMITS.js, description: "Sin etiquetas <script>" },
    }),
    run: (a, call) => updateAppearance(call, (n) => {
      if (a.css === undefined && a.html_head === undefined && a.html_body === undefined && a.javascript === undefined) return "Manda al menos uno: css, html_head, html_body o javascript.";
      if (a.css !== undefined) n.code.css = String(a.css);
      if (a.html_head !== undefined) n.code.headHtml = String(a.html_head);
      if (a.html_body !== undefined) n.code.bodyHtml = String(a.html_body);
      if (a.javascript !== undefined) n.code.js = String(a.javascript);
      return null;
    }, codeSummary),
  },
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
