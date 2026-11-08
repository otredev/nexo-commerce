/**
 * Platform administration (/admin): operators, metrics, users, log, support access and tickets.
 * Shared by the API, the /admin panel and the business panel (Soporte page).
 */
import { z } from "zod";
import type { PlanId } from "./plans";
import type { Role } from "./roles";

/* ---------- Labels ---------- */

export const TICKET_STATUSES = ["open", "waiting", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** As the business reads them (Soporte page). */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = { open: "En revisión", waiting: "Respondido", closed: "Cerrado" };
/** As support reads them (/admin). */
export const TICKET_STATUS_LABELS_OPERATOR: Record<TicketStatus, string> = { open: "Por responder", waiting: "Esperando al negocio", closed: "Cerrado" };

export const TICKET_CATEGORIES = ["question", "problem", "billing", "suggestion"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = { question: "Pregunta", problem: "Algo no funciona", billing: "Plan y pagos", suggestion: "Sugerencia" };

export const TICKET_PRIORITIES = ["normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = { normal: "Normal", high: "Alta", urgent: "Urgente" };

/** How long an operator stays inside a business ("Entrar como negocio"). */
export const SUPPORT_ACCESS_MINUTES = 60;

/** What the platform log shows for each action. */
export const PLATFORM_ACTION_LABELS: Record<string, string> = {
  "operator.login": "Inició sesión",
  "operator.login_failed": "Intento de sesión fallido",
  "operator.create": "Creó un operador",
  "operator.update": "Cambió un operador",
  "operator.password": "Cambió su contraseña",
  "tenant.suspend": "Suspendió un negocio",
  "tenant.reactivate": "Reactivó un negocio",
  "tenant.plan": "Cambió el plan",
  "tenant.move": "Movió de base de datos",
  "tenant.support_access": "Entró como negocio",
  "user.reset_link": "Generó enlace de contraseña",
  "user.unlock": "Desbloqueó inicio de sesión",
  "user.logout_all": "Cerró sesiones",
  "user.disable": "Desactivó un usuario",
  "user.enable": "Reactivó un usuario",
  "ticket.reply": "Respondió un ticket",
  "ticket.note": "Agregó nota interna",
  "ticket.update": "Actualizó un ticket",
};

/* ---------- Operators ---------- */

export interface PlatformOperator {
  id: string;
  email: string;
  name: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface OperatorMe {
  operator: Pick<PlatformOperator, "id" | "email" | "name">;
  /** Tickets waiting for support, for the nav badge. */
  openTickets: number;
}

/* ---------- Metrics ---------- */

export interface PlatformMetrics {
  tenants: { total: number; active: number; suspended: number; newThisMonth: number; newLastMonth: number };
  /** Businesses on each effective plan. */
  byPlan: Record<PlanId, number>;
  billing: {
    /** Monthly recurring revenue: paid plans with a Stripe subscription that is active or past due. */
    mrrCents: number;
    subscribed: number;
    trialing: number;
    pastDue: number;
    /** Paid plan set by hand (no subscription). */
    courtesy: number;
  };
  users: { total: number; newLast30d: number; disabled: number };
  /** New businesses per month, oldest first (12 months, YYYY-MM). */
  signups: Array<{ month: string; count: number }>;
  /** Point-of-sale sales and online orders of every business, last 30 days. */
  activity: {
    days: Array<{ date: string; sales: number; orders: number }>;
    sales30d: number;
    orders30d: number;
    /** Businesses with at least one sale or order in 30 days. */
    activeTenants30d: number;
    /** Money is never added across currencies. */
    volumeByCurrency: Array<{ currency: string; cents: number }>;
    top: Array<{ tenantId: string; name: string; sales: number; orders: number }>;
  };
  support: { open: number; waiting: number; unassigned: number };
}

/* ---------- Users ---------- */

export interface PlatformUserMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  role: Role;
  active: boolean;
}

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  disabledAt: string | null;
  deletedAt: string | null;
  lastLoginAt: string | null;
  /** Too many failed sign-ins in the last 15 minutes. */
  locked: boolean;
  memberships: PlatformUserMembership[];
}

export interface PlatformUserDetail extends PlatformUser {
  sessions: number;
  attempts: Array<{ success: boolean; ip: string | null; createdAt: string }>;
}

/* ---------- Log ---------- */

export interface PlatformAuditEntry {
  id: string;
  operatorId: string | null;
  operatorName: string;
  action: string;
  entity: string;
  entityId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  summary: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

/* ---------- Support ---------- */

export interface SupportMessage {
  id: string;
  authorType: "user" | "operator" | "system";
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  number: number;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  allowAccess: boolean;
  createdByName: string;
  createdByEmail: string;
  lastMessageAt: string;
  closedAt: string | null;
  createdAt: string;
  messages?: number;
  /** /admin only. */
  tenant?: { id: string; name: string; slug: string; plan: PlanId; status: string };
  assignedTo?: { id: string; name: string } | null;
}

export interface SupportTicketDetail extends SupportTicket {
  thread: SupportMessage[];
}

/** /me of a session opened by support ("Entrar como negocio"). */
export interface SupportSessionInfo {
  operatorName: string;
  expiresAt: string;
  ticketNumber: number | null;
}

/* ---------- Validation ---------- */

const email = z.string().trim().toLowerCase().email("Correo no válido").max(254);
const password = z.string().min(10, "Usa al menos 10 caracteres").max(128, "Máximo 128 caracteres");
const body = z.string().trim().min(1, "Escribe un mensaje").max(5000, "Máximo 5 000 caracteres");

export const operatorLoginSchema = z.object({ email, password: z.string().min(1, "Requerido").max(128) });
export const operatorCreateSchema = z.object({ name: z.string().trim().min(1, "Requerido").max(120), email, password });
/** password: another operator sets a new one (forgotten password); the person changes it later. */
export const operatorUpdateSchema = z.object({ active: z.boolean().optional(), name: z.string().trim().min(1).max(120).optional(), password: password.optional() });
export const operatorPasswordSchema = z.object({ currentPassword: z.string().min(1, "Requerido"), newPassword: password });

export const platformUserUpdateSchema = z.object({ disabled: z.boolean() });

export const supportAccessSchema = z.object({
  /** Why support enters (shown to the business in its activity). Required unless it comes from a ticket. */
  reason: z.string().trim().max(300).optional().default(""),
  ticketId: z.string().max(40).nullable().optional().default(null),
});

export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(3, "Escribe el asunto").max(140, "Máximo 140 caracteres"),
  category: z.enum(TICKET_CATEGORIES).default("question"),
  body,
  allowAccess: z.boolean().default(false),
});
export const ticketReplySchema = z.object({ body });
export const ticketBusinessUpdateSchema = z.object({ allowAccess: z.boolean().optional(), status: z.enum(["closed", "open"]).optional() });

export const operatorReplySchema = z.object({ body, internal: z.boolean().default(false) });
export const operatorTicketUpdateSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  /** Operator id, or null to unassign. */
  assignedTo: z.string().max(40).nullable().optional(),
});
