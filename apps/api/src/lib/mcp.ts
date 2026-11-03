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
import { can, MOVEMENT_REASONS, PAYMENT_CODES, type Permission } from "@nexo/shared";
import type { AppEnv } from "../env";
import { bearerKey, loadApiKey, type KeySession } from "./apiKeys";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const SERVER_INFO = { name: "nexo", title: "Nexo", version: "1.0.0" };
const INSTRUCTIONS =
  "Herramientas de Nexo para el negocio conectado: catálogo, existencias, ventas, reportes, pedidos de la tienda en línea y clientes. " +
  "Las cantidades de dinero vienen en centavos (…Cents): divide entre 100. Las fechas son AAAA-MM-DD en la zona horaria del negocio. " +
  "Antes de cambiar algo (existencias, pedidos), confirma con la persona.";

type Call = (method: "GET" | "POST", path: string, body?: unknown) => Promise<Response>;
type Args = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  permission: Permission;
  write?: boolean;
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
            annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
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
