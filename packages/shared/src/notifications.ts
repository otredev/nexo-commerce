/**
 * Push notifications (Phase 8): what can be notified, to whom (by permission) and how it reads.
 */
import type { Permission } from "./roles";

export const NOTIFICATION_EVENTS = [
  { id: "order_new", label: "Pedido nuevo en la tienda", help: "Cuando un cliente hace un pedido en línea.", permission: "orders:read" },
  { id: "order_paid", label: "Pago con tarjeta recibido", help: "Cuando Stripe confirma el pago de un pedido.", permission: "orders:read" },
  { id: "daily_digest", label: "Resumen de la mañana", help: "A las 8:00: productos con poco inventario y facturas por vencer.", permission: "inventory:read" },
  { id: "billing", label: "Avisos de tu suscripción", help: "Si no se pudo cobrar tu plan.", permission: "billing:write" },
] as const satisfies ReadonlyArray<{ id: string; label: string; help: string; permission: Permission }>;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]["id"];

export interface NotificationDevice {
  id: string;
  device: string | null;
  createdAt: string;
  lastSentAt: string | null;
}

export interface NotificationSettings {
  /** The platform has VAPID keys (otherwise push cannot work yet). */
  available: boolean;
  publicKey: string | null;
  /** Events this person can receive, with their choice. */
  events: Array<{ id: NotificationEvent; label: string; help: string; enabled: boolean }>;
  devices: NotificationDevice[];
}

/** "iPhone · Safari", "Windows · Chrome"… from a user agent, for the device list. */
export function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Dispositivo";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return `${os} · ${browser}`;
}

/* ---------- Customer display (Phase 8) ---------- */

/** What the customer sees on the second screen while the cashier sells. Sent whole on every change. */
export interface DisplayState {
  v: 1;
  business: { name: string; logoKey: string | null };
  currency: string;
  locale: string;
  /** idle: welcome screen · cart: items being scanned · paying: collecting payment · paid: thank you + change. */
  phase: "idle" | "cart" | "paying" | "paid";
  lines: Array<{ key: string; name: string; detail: string; quantity: string; totalCents: number; savingCents: number }>;
  itemsCount: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  pricesIncludeTax: boolean;
  paidCents: number;
  changeCents: number;
  customerName: string | null;
  /** Folio of the finished sale (paid phase). */
  saleNumber: number | null;
  at: number;
}
