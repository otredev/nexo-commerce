import { describe, expect, it } from "vitest";
import {
  operatorTicketUpdateSchema, PLATFORM_ACTION_LABELS, supportAccessSchema, ticketCreateSchema, TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS, TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_STATUS_LABELS_OPERATOR,
} from "./platform";
import { can } from "./roles";

describe("platform administration", () => {
  it("labels every ticket status, category and priority in Spanish", () => {
    for (const s of TICKET_STATUSES) expect(TICKET_STATUS_LABELS[s] && TICKET_STATUS_LABELS_OPERATOR[s]).toBeTruthy();
    for (const c of TICKET_CATEGORIES) expect(TICKET_CATEGORY_LABELS[c]).toBeTruthy();
    for (const p of TICKET_PRIORITIES) expect(TICKET_PRIORITY_LABELS[p]).toBeTruthy();
  });
  it("labels the platform log actions", () => {
    for (const a of ["operator.login", "tenant.support_access", "user.disable", "ticket.reply"]) expect(PLATFORM_ACTION_LABELS[a]).toBeTruthy();
  });
  it("validates a new ticket", () => {
    expect(ticketCreateSchema.safeParse({ subject: "Hola", body: "" }).success).toBe(false);
    const ok = ticketCreateSchema.parse({ subject: "  El corte no cuadra ", body: "Detalle" });
    expect(ok).toMatchObject({ subject: "El corte no cuadra", category: "question", allowAccess: false });
  });
  it("support access defaults to no reason and no ticket", () => {
    expect(supportAccessSchema.parse({})).toEqual({ reason: "", ticketId: null });
  });
  it("lets an operator unassign a ticket with null", () => {
    expect(operatorTicketUpdateSchema.parse({ assignedTo: null })).toEqual({ assignedTo: null });
  });
  it("support tickets are for owners and admins, not cashiers", () => {
    expect(can("owner", "support:use")).toBe(true);
    expect(can("admin", "support:use")).toBe(true);
    expect(can("cashier", "support:use")).toBe(false);
  });
});
