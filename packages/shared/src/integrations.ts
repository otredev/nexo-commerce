import { z } from "zod";
/**
 * Integrations (Phase 11): API keys, outgoing webhooks and the MCP server for AI assistants.
 */
import type { Role } from "./roles";

/* The shared package is environment-neutral (no DOM lib); URL exists in Workers, browsers and Node. */
type ParsedUrl = { protocol: string; hostname: string; username: string; password: string };
const parseUrl = (raw: string): ParsedUrl => new (globalThis as unknown as { URL: new (u: string) => ParsedUrl }).URL(raw);

/* ---------- API keys ---------- */

/**
 * What a key can do. A key acts like a team member with that role (never owner: no billing),
 * optionally read-only (only GET requests).
 */
export const API_KEY_ACCESS = {
  read: { label: "Solo lectura", help: "Consulta productos, existencias, ventas, pedidos, clientes y reportes. No cambia nada.", role: "admin", readOnly: true },
  full: { label: "Lectura y escritura", help: "Como un administrador: también crea y edita productos, inventario, pedidos y clientes.", role: "admin", readOnly: false },
  pos: { label: "Caja", help: "Como un cajero: vende, consulta catálogo y existencias, y atiende pedidos. Sin costos ni reportes.", role: "cashier", readOnly: false },
} as const satisfies Record<string, { label: string; help: string; role: Exclude<Role, "owner">; readOnly: boolean }>;
export type ApiKeyAccess = keyof typeof API_KEY_ACCESS;
export const API_KEY_ACCESS_IDS = Object.keys(API_KEY_ACCESS) as ApiKeyAccess[];

export interface ApiKey {
  id: string;
  name: string;
  /** First characters, to recognize it (the full key is shown only once). */
  prefix: string;
  access: ApiKeyAccess;
  createdByName: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** API paths a key may never use: people, money and the integrations themselves. */
export const API_KEY_BLOCKED_PATHS = ["/api/users", "/api/billing", "/api/platform", "/api/notifications", "/api/integrations", "/api/pos/display", "/api/dev", "/api/support"];

/* ---------- Webhooks ---------- */

export const WEBHOOK_EVENTS = {
  "order.created": "Pedido nuevo en la tienda",
  "order.paid": "Pedido pagado",
  "order.status_changed": "Pedido cambió de estado (aceptado, listo, entregado, cancelado)",
  "sale.completed": "Venta en caja",
  "sale.voided": "Venta anulada",
  "sale.returned": "Devolución en caja",
  "product.created": "Producto creado",
  "product.updated": "Producto editado, archivado o restaurado",
  "product.deleted": "Producto eliminado",
  "stock.changed": "Existencias ajustadas a mano (entrada, salida o conteo)",
} as const;
export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  /** Subscribed events; empty = all. */
  events: WebhookEventType[];
  active: boolean;
  /** Signing secret (whsec_…). */
  secret: string;
  createdAt: string;
  lastSuccessAt: string | null;
  /** Consecutive failed deliveries. */
  failures: number;
}

export type WebhookDeliveryStatus = "pending" | "succeeded" | "failed";
export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  type: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

/** What every webhook POST carries. */
export interface WebhookPayload<T = unknown> {
  id: string;
  type: WebhookEventType | "ping";
  created: string;
  business: { id: string; slug: string };
  data: T;
}

/** Minutes to wait after each failed attempt; after the last one the delivery is given up. */
export const WEBHOOK_RETRY_MINUTES = [1, 10, 60, 360, 1440] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_MINUTES.length + 1;

/**
 * Webhook URLs: https, a real public host. Local and private addresses are refused
 * (http and localhost are allowed only in development, for tests).
 */
export function webhookUrlProblem(raw: string, allowLocal = false): string | null {
  let u: ParsedUrl;
  try { u = parseUrl(raw); } catch { return "Dirección no válida"; }
  if (u.username || u.password) return "Sin usuario ni contraseña en la dirección";
  if (u.protocol !== "https:" && !(allowLocal && u.protocol === "http:")) return "Debe empezar con https://";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowLocal) return null;
  const privateHost =
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") ||
    /^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || /^::ffff:/.test(h);
  if (privateHost) return "Usa una dirección pública de internet";
  return null;
}

/* ---------- Settings → Integraciones ---------- */

export interface IntegrationsSettings {
  apiKeys: ApiKey[];
  webhooks: WebhookEndpoint[];
  limits: { apiKeys: number | null; webhooks: number | null };
  /** Base URL of the API and the MCP endpoint, for the instructions. */
  apiUrl: string;
  mcpUrl: string;
  /** Text messages (Twilio). The auth token never comes back. */
  sms: { provider: "twilio"; accountSid: string; sender: string; updatedAt: string } | null;
}

/** Twilio of the business. On update, an empty authToken keeps the saved one. */
export const smsSettingsSchema = z.object({
  accountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, "Empieza con AC y tiene 34 caracteres"),
  authToken: z.string().trim().max(128).nullable().default(null).transform((v) => (v ? v : null)).refine((v) => v === null || /^[0-9a-zA-Z]{20,128}$/.test(v), "Auth Token no válido"),
  sender: z.string().trim().regex(/^(?:\+[1-9]\d{7,14}|MG[0-9a-fA-F]{32})$/, "Un número de Twilio (+13055550100) o un Messaging Service SID (MG…)"),
});
export const smsTestSchema = z.object({ phone: z.string().trim().min(7, "Escribe el teléfono").max(32).regex(/^[+\d\s()-]+$/, "Teléfono no válido") });
