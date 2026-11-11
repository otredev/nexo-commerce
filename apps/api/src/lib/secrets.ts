/**
 * Secrets a business gives us (its Twilio auth token): AES-GCM with SECRETS_KEY (32 bytes, base64).
 * Format "v1.<iv>.<ciphertext>" (base64url). The tenant id is the associated data, so a value copied to
 * another business does not decrypt. In development without SECRETS_KEY a fixed key is used.
 */
import type { Env } from "../env";
import { AppError } from "./errors";

const DEV_KEY = "bmV4by1kZXYtb25seS1zZWNyZXRzLWtleS0zMmJ5dGU="; // "nexo-dev-only-secrets-key-32byte"
const b64u = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0)),
};

async function key(env: Pick<Env, "SECRETS_KEY" | "APP_ENV">) {
  const raw = env.SECRETS_KEY ?? (env.APP_ENV === "development" ? DEV_KEY : null);
  if (!raw) throw new AppError(503, "secrets_unavailable", "Falta configurar SECRETS_KEY en este entorno.");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new AppError(503, "secrets_unavailable", "SECRETS_KEY debe tener 32 bytes en base64.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealSecret(env: Pick<Env, "SECRETS_KEY" | "APP_ENV">, tenantId: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(tenantId) }, await key(env), new TextEncoder().encode(plain)));
  return `v1.${b64u.enc(iv)}.${b64u.enc(ct)}`;
}

export async function openSecret(env: Pick<Env, "SECRETS_KEY" | "APP_ENV">, tenantId: string, sealed: string) {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new AppError(500, "secret_corrupt", "No se pudo leer la llave guardada. Vuelve a capturarla.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u.dec(iv), additionalData: new TextEncoder().encode(tenantId) }, await key(env), b64u.dec(ct));
    return new TextDecoder().decode(plain);
  } catch {
    throw new AppError(500, "secret_corrupt", "No se pudo leer la llave guardada. Vuelve a capturarla.");
  }
}
