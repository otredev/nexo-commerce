/**
 * Tap to Pay on the customer display, inside the Nexo display app for Android (Capacitor with the
 * @capacitor-community/stripe-terminal plugin). In a normal browser there is no plugin and nothing here runs.
 *
 * The device only collects and confirms the PaymentIntent the register created; whether it was paid is
 * decided by the server, which asks Stripe. Connection tokens come from /api/display/:code/terminal/token
 * (the pairing code is the key) and are scoped to the register's store.
 */
import { useEffect, useRef } from "react";
import type { DisplayDevice, DisplayState } from "@nexo/shared";

interface Reader { serialNumber?: string; [k: string]: unknown }
interface StripeTerminalPlugin {
  initialize(o: { tokenProviderEndpoint?: string; isTest: boolean }): Promise<void>;
  discoverReaders(o: { type: string; locationId?: string }): Promise<{ readers: Reader[] }>;
  connectReader(o: { reader: Reader; autoReconnectOnUnexpectedDisconnect?: boolean }): Promise<void>;
  getConnectedReader(): Promise<{ reader: Reader | null }>;
  collectPaymentMethod(o: { paymentIntent: string }): Promise<void>;
  cancelCollectPaymentMethod(): Promise<void>;
  confirmPaymentIntent(): Promise<void>;
}

const plugin = (): StripeTerminalPlugin | null => {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { StripeTerminal?: StripeTerminalPlugin } } }).Capacitor;
  return cap?.isNativePlatform?.() && cap.Plugins?.StripeTerminal ? cap.Plugins.StripeTerminal : null;
};
export const hasTapToPay = () => Boolean(plugin());

const errText = (e: unknown) => {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  if (/nfc/i.test(m)) return "Activa el NFC del dispositivo.";
  if (/location/i.test(m)) return "Activa la ubicación del dispositivo (Stripe la pide para Tap to Pay).";
  if (/attest|integrity|root|developer/i.test(m)) return "Este dispositivo no cumple los requisitos de seguridad de Tap to Pay.";
  return m.slice(0, 180) || "No se pudo preparar Tap to Pay.";
};

/**
 * Prepares the reader once (initialize, discover Tap to Pay, connect) and collects each new card charge
 * the register asks for (`state.card` with a new id or a new attempt). Reports what it can do with `report`.
 */
export function useTapToPay(code: string | null, state: DisplayState | null, report: (d: DisplayDevice) => void) {
  const ready = useRef<Promise<boolean> | null>(null);
  const handled = useRef<string | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    const st = plugin();
    if (!st || !code) return;
    const isTest = /staging|localhost|127\.0\.0\.1/.test(window.location.hostname) || new URLSearchParams(window.location.search).has("simulado");
    ready.current = (async () => {
      try {
        reportRef.current({ tapToPay: true, ready: false, error: null });
        await st.initialize({ tokenProviderEndpoint: `${window.location.origin}/api/display/${code}/terminal/token`, isTest });
        const tokenInfo = await fetch(`/api/display/${code}/terminal/token`, { method: "POST" }).then((r) => r.json() as Promise<{ location?: string; error?: { message?: string } }>);
        if (!tokenInfo.location) throw new Error(tokenInfo.error?.message ?? "Activa el cobro con tarjeta en la caja.");
        const connected = await st.getConnectedReader().catch(() => ({ reader: null }));
        if (!connected.reader) {
          const { readers } = await st.discoverReaders({ type: "tap-to-pay", locationId: tokenInfo.location });
          if (!readers[0]) throw new Error("Este dispositivo no admite Tap to Pay.");
          await st.connectReader({ reader: readers[0], autoReconnectOnUnexpectedDisconnect: true });
        }
        reportRef.current({ tapToPay: true, ready: true, error: null });
        return true;
      } catch (e) {
        reportRef.current({ tapToPay: true, ready: false, error: errText(e) });
        return false;
      }
    })();
  }, [code]);

  const card = state?.phase === "card" ? state.card : null;
  useEffect(() => {
    const st = plugin();
    if (!st || !card || card.status !== "waiting") return;
    const key = `${card.id}:${card.attempt}`;
    if (handled.current === key) return;
    handled.current = key;
    void (async () => {
      if (!(await ready.current)) return;
      try {
        // The phone/card is read here (Stripe's own Tap to Pay screen); the register follows it through Stripe.
        await st.collectPaymentMethod({ paymentIntent: card.clientSecret });
        await st.confirmPaymentIntent();
      } catch {
        // A decline or a cancel shows up in the PaymentIntent; the register reads it from Stripe.
      }
    })();
  }, [card?.id, card?.attempt, card?.status]);

  // The register cancelled (or the sale ended): stop waiting for a card.
  useEffect(() => {
    const st = plugin();
    if (!st || card) return;
    if (handled.current) void st.cancelCollectPaymentMethod().catch(() => {});
  }, [card]);
}
