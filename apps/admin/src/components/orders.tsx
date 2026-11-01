import { ORDER_STATUS_LABELS, type OrderStatus } from "@nexo/shared";
import { Badge } from "@nexo/ui";

const TONE: Record<OrderStatus, "neutral" | "info" | "success" | "warning" | "danger" | "accent"> = {
  pending: "warning",
  confirmed: "info",
  ready: "accent",
  completed: "success",
  cancelled: "danger",
};

export const OrderStatusBadge = ({ status, fulfillment }: { status: OrderStatus; fulfillment?: "pickup" | "delivery" }) => (
  <Badge tone={TONE[status]}>{status === "ready" && fulfillment === "delivery" ? "En camino" : status === "ready" ? "Listo para recoger" : ORDER_STATUS_LABELS[status]}</Badge>
);

export const PaymentBadge = ({ status }: { status: "pending" | "paid" }) =>
  status === "paid" ? <Badge tone="success" plain>Pagado</Badge> : <Badge plain>Por cobrar</Badge>;

export const orderLabel = (n: number) => `#${String(n).padStart(6, "0")}`;

/** "hace 5 min", "hace 2 h", or the date. */
export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(iso));
}

export { whatsappLink as whatsappTo } from "@nexo/shared";
