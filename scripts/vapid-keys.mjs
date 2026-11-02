// Generates the VAPID key pair for Web Push (Phase 8). Run once per environment:
//   node scripts/vapid-keys.mjs
// then store them with `npx wrangler secret put VAPID_PUBLIC_KEY --env staging` (and VAPID_PRIVATE_KEY).
// Changing the keys later invalidates every device already subscribed.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(`VAPID_PUBLIC_KEY=${b64u(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("VAPID_SUBJECT=mailto:tu@correo.com");
