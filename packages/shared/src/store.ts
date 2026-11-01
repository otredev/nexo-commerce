/**
 * Online store: pure helpers shared by the API, the dashboard and the public store.
 */
import { taxOnNet, type BasisPoints, type Cents } from "./money";

export const ORDER_STATUSES = ["pending", "confirmed", "ready", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Nuevo",
  confirmed: "Aceptado",
  ready: "Listo",
  completed: "Entregado",
  cancelled: "Cancelado",
};
/** Wording for the customer, which depends on how the order is fulfilled. */
export function customerStatusLabel(status: OrderStatus, fulfillment: Fulfillment): string {
  if (status === "pending") return "Recibido";
  if (status === "confirmed") return "En preparación";
  if (status === "ready") return fulfillment === "pickup" ? "Listo para recoger" : "En camino";
  if (status === "completed") return "Entregado";
  return "Cancelado";
}

export type Fulfillment = "pickup" | "delivery";
export const FULFILLMENT_LABELS: Record<Fulfillment, string> = { pickup: "Recoger en tienda", delivery: "Envío a domicilio" };

export type OnlinePaymentMethod = "on_delivery" | "transfer";
export const ONLINE_PAYMENT_LABELS: Record<OnlinePaymentMethod, string> = { on_delivery: "Pago al recibir", transfer: "Transferencia bancaria" };

/** Price the customer sees: with tax, whatever the business's pricing setting. */
export function displayPrice(priceCents: Cents, taxRateBps: BasisPoints, pricesIncludeTax: boolean): Cents {
  return pricesIncludeTax ? priceCents : priceCents + taxOnNet(priceCents, taxRateBps);
}

export interface ShippingRules {
  deliveryFeeCents: Cents;
  freeDeliveryFromCents: Cents | null;
}
/** Delivery fee for an order of `itemsTotal` (with tax). Pickup is always free. */
export function shippingFor(rules: ShippingRules, itemsTotalCents: Cents, fulfillment: Fulfillment): Cents {
  if (fulfillment === "pickup") return 0;
  if (rules.freeDeliveryFromCents !== null && itemsTotalCents >= rules.freeDeliveryFromCents) return 0;
  return rules.deliveryFeeCents;
}

/** Products with this much stock or less show "Últimas piezas". */
export const LOW_STOCK_BADGE = 5;

/** WhatsApp chat link. 10-digit numbers are taken as Mexican (+52); longer ones must include the country code. */
export function whatsappLink(phone: string, text?: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `52${digits}`;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
