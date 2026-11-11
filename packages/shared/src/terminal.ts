/**
 * Card payments at the register with Stripe Terminal (Phase 12): Tap to Pay on the customer display
 * (an Android device running the Nexo display app). The register creates the PaymentIntent on the
 * business's connected account; the device collects it; the server checks it with Stripe before the
 * sale is saved.
 */
import { z } from "zod";

/** Address Stripe needs for a Terminal location (one per store of the business). */
export const terminalLocationSchema = z.object({
  line1: z.string().trim().min(3, "Escribe la calle y número").max(200),
  city: z.string().trim().min(2, "Escribe la ciudad").max(100),
  state: z.string().trim().max(100).default(""),
  postalCode: z.string().trim().min(3, "Escribe el código postal").max(20),
  country: z.string().trim().toUpperCase().length(2, "Código de país de 2 letras (US, MX)"),
});
export type TerminalLocationInput = z.input<typeof terminalLocationSchema>;

export interface TerminalStatus {
  /** Card payments can run at the register (Stripe connected and charging, plan allows it). */
  available: boolean;
  /** Why not, when it isn't. */
  reason: string | null;
  locations: Array<{ id: string; name: string; terminalLocationId: string | null }>;
}

export type TerminalPaymentStatus = "waiting" | "processing" | "succeeded" | "failed" | "canceled";

/** A card charge in progress, as the register and the customer display see it. */
export interface TerminalPayment {
  id: string;
  /** For the device to collect it (Stripe Terminal SDK). */
  clientSecret: string;
  amountCents: number;
  currency: string;
  status: TerminalPaymentStatus;
  /** Last decline or error, in Spanish, for the customer. */
  error: string | null;
}

export const terminalPaymentCreateSchema = z.object({
  locationId: z.string().min(1).max(40),
  amountCents: z.number().int().min(50, "Mínimo 0.50").max(99_999_999),
  /** The sale's clientId: retrying never creates two charges. */
  clientId: z.string().min(8).max(64),
});

/** The display app tells the register what it can do (sent over the display's socket). */
export const displayDeviceMessageSchema = z
  .object({ type: z.literal("device"), tapToPay: z.boolean(), ready: z.boolean(), error: z.string().max(200).nullable().default(null) })
  .strict();
export type DisplayDevice = Omit<z.infer<typeof displayDeviceMessageSchema>, "type">;

/** Spanish message for a Stripe decline code (what the customer reads on the display). */
export function declineMessage(code: string | null | undefined): string {
  switch (code) {
    case "insufficient_funds": return "Fondos insuficientes. Prueba con otra tarjeta.";
    case "expired_card": return "La tarjeta está vencida.";
    case "incorrect_pin": case "invalid_pin": return "PIN incorrecto. Intenta de nuevo.";
    case "card_not_supported": return "Esta tarjeta no se acepta aquí.";
    case "do_not_honor": case "generic_decline": case "card_declined": return "Tu banco rechazó el pago. Prueba con otra tarjeta.";
    case "processing_error": return "Hubo un error al procesar. Intenta de nuevo.";
    case "offline_pin_required": case "online_or_offline_pin_required": return "Tu tarjeta pide PIN: inserta la tarjeta o usa otra.";
    default: return code ? "No se pudo cobrar. Intenta de nuevo o usa otro método." : "No se pudo cobrar. Intenta de nuevo.";
  }
}
