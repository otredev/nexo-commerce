/**
 * Push notifications (Phase 8): what can be notified, to whom (by permission) and how it reads.
 */
import { z } from "zod";
import type { Permission } from "./roles";
import type { TerminalPayment } from "./terminal";

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
  /**
   * idle: welcome screen · cart: items being scanned · signup: the customer may register (optional) ·
   * paying: collecting payment · paid: thank you + change.
   */
  phase: "idle" | "cart" | "signup" | "paying" | "card" | "paid";
  /** phase "card": the charge the display device collects with Tap to Pay, and how it is going. */
  card?: (TerminalPayment & { attempt: number }) | null;
  /** While phase is "signup": which request the display answers, and the register's error, if any. */
  signup?: { id: string; error: string | null } | null;
  /**
   * What the customer may do on the display right now, under one request id (the hub only forwards
   * messages with this id): `account` = «Registrarme / Ya soy cliente» buttons during the sale;
   * `receipt` = how they want their receipt after paying (the methods the owner enabled).
   */
  ask?: { id: string; account: boolean; receipt: ReceiptMethod[] | null } | null;
  /** Masked contact of the identified customer, to offer «send it to a•••@gmail.com». */
  receiptTo?: { email: string | null; phone: string | null } | null;
  /** A short message for the customer: looking up their account, an error, «¡Hola, Ana!», «Recibo enviado». */
  notice?: { tone: "info" | "success" | "error"; text: string } | null;
  lines: Array<{ key: string; name: string; detail: string; quantity: string; totalCents: number; savingCents: number }>;
  itemsCount: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  pricesIncludeTax: boolean;
  paidCents: number;
  changeCents: number;
  /** Only the first name: the display is in front of other people. */
  customerName: string | null;
  /** Folio of the finished sale (paid phase). */
  saleNumber: number | null;
  at: number;
}

/* ---------- Customer display → register: self sign-up (optional, before paying) ---------- */

const signupId = z.string().regex(/^[A-Za-z0-9_-]{6,40}$/);

/** How the customer may get the receipt; the owner picks which ones are offered. */
export const RECEIPT_METHODS = { sms: "Texto", email: "Correo", print: "Impreso", none: "Sin recibo" } as const;
export type ReceiptMethod = keyof typeof RECEIPT_METHODS;
export const RECEIPT_METHOD_IDS = Object.keys(RECEIPT_METHODS) as ReceiptMethod[];
const phoneField = z.string().trim().max(32).regex(/^[+\d\s()-]*$/, "Teléfono no válido");

/**
 * The only thing a display may send back. The register checks it again (customerSchema) before creating
 * the customer; the display hub forwards it only while the register is asking for that same id.
 */
export const displaySignupMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("signup"),
      id: signupId,
      name: z.string().trim().min(2, "Escribe tu nombre").max(120),
      email: z.union([z.string().trim().toLowerCase().email("Correo no válido").max(254), z.literal("")]).nullable().default(null).transform((v) => (v ? v : null)),
      phone: z.string().trim().max(32).regex(/^[+\d\s()-]*$/, "Teléfono no válido").nullable().default(null).transform((v) => (v ? v : null)),
      acceptsMarketing: z.boolean().default(false),
    })
    .strict()
    .refine((m) => m.email || m.phone, { message: "Escribe tu teléfono o tu correo", path: ["phone"] }),
  z.object({ type: z.literal("signup_skip"), id: signupId }).strict(),
  /** «Ya soy cliente»: the register looks the phone up and the cashier confirms who it is. */
  z.object({ type: z.literal("login"), id: signupId, phone: phoneField.refine((v) => v.replace(/\D/g, "").length >= 7, "Escribe tu teléfono completo") }).strict(),
  /** After paying. `to` = another email or phone; null = the one on the customer's record. */
  z
    .object({ type: z.literal("receipt"), id: signupId, method: z.enum(RECEIPT_METHOD_IDS as [ReceiptMethod, ...ReceiptMethod[]]), to: z.string().trim().max(254).nullable().default(null).transform((v) => (v ? v : null)) })
    .strict()
    .superRefine((m, ctx) => {
      if (!m.to) return;
      if (m.method === "email" && !z.string().email().safeParse(m.to).success) ctx.addIssue({ code: "custom", message: "Correo no válido", path: ["to"] });
      if (m.method === "sms" && (!/^[+\d\s()-]*$/.test(m.to) || m.to.replace(/\D/g, "").length < 7)) ctx.addIssue({ code: "custom", message: "Teléfono no válido", path: ["to"] });
    }),
]);

/** Which request a display message answers (the hub checks it against the state it holds). */
export function displayMessageAllowed(state: Pick<DisplayState, "phase" | "signup" | "ask"> | null, m: DisplaySignupMessage): boolean {
  if (!state) return false;
  if (state.phase === "signup" && state.signup?.id === m.id && (m.type === "signup" || m.type === "signup_skip")) return true;
  const ask = state.ask;
  if (!ask || ask.id !== m.id) return false;
  if (m.type === "receipt") return Boolean(ask.receipt?.includes(m.method));
  return ask.account;
}

/** «a•••@gmail.com», «•••• 0142»: enough for the customer to recognize it, not for others to read it. */
export const maskEmail = (e: string | null | undefined) => {
  if (!e || !e.includes("@")) return null;
  const [u, d] = e.split("@");
  return `${u!.slice(0, 1)}•••@${d}`;
};
export const maskPhone = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : null;
};
export type DisplaySignupMessage = z.infer<typeof displaySignupMessageSchema>;
export const DISPLAY_MESSAGE_MAX = 2_000;

/** First word of a name: what the display shows of the customer. */
export const firstNameOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || null;
