/**
 * The app opens the customer display of the Nexo dashboard (/pantalla) inside a native shell that adds
 * Tap to Pay (Stripe Terminal). The page detects the plugin (apps/admin/src/pages/pos/tapToPay.ts).
 * NEXO_URL: https://nexo-api-staging.nexo-commerce.workers.dev (staging) or the production dashboard.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const url = (process.env.NEXO_URL ?? "https://nexo-api-staging.nexo-commerce.workers.dev").replace(/\/$/, "");

const config: CapacitorConfig = {
  appId: "app.nexo.display",
  appName: "Nexo Pantalla",
  webDir: "www",
  server: {
    url: `${url}/pantalla`,
    // Only the dashboard's own origin runs inside the app (and gets the native bridge).
    allowNavigation: [new URL(url).hostname],
    cleartext: false,
  },
  android: { allowMixedContent: false },
};

export default config;
