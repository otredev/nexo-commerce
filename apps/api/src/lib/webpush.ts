/**
 * Web Push from a Worker, with WebCrypto only:
 * - Message encryption "aes128gcm" (RFC 8291 + RFC 8188).
 * - VAPID authentication (RFC 8292): an ES256 JWT signed with the platform's key pair.
 * Keys are base64url: VAPID_PUBLIC_KEY = uncompressed P-256 point (65 bytes), VAPID_PRIVATE_KEY = d (32 bytes).
 * Generate them once with `node scripts/vapid-keys.mjs`.
 */

const enc = new TextEncoder();

export const b64u = {
  encode(bytes: ArrayBuffer | Uint8Array): string {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
/** HKDF with a single block of output (enough for every length used here). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** Standard WebCrypto shape ({ name, public }); the Workers types spell the key "$public". */
const ecdh = (publicKey: CryptoKey) => ({ name: "ECDH", public: publicKey }) as unknown as SubtleCryptoDeriveKeyAlgorithm;
const importPublic = (raw: Uint8Array) => crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);

export interface EncryptOptions {
  /** For tests (RFC 8291 §5): fixed sender key pair and salt. */
  senderPrivate?: Uint8Array;
  senderPublic?: Uint8Array;
  salt?: Uint8Array;
}

/** Encrypts a payload for one subscription (p256dh and auth from the browser, base64url). */
export async function encryptPayload(payload: Uint8Array, p256dh: string, auth: string, opts: EncryptOptions = {}): Promise<Uint8Array> {
  const uaPublic = b64u.decode(p256dh);
  const authSecret = b64u.decode(auth);
  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;
  if (opts.senderPrivate && opts.senderPublic) {
    asPublic = opts.senderPublic;
    asPrivateKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", d: b64u.encode(opts.senderPrivate), x: b64u.encode(asPublic.slice(1, 33)), y: b64u.encode(asPublic.slice(33, 65)), ext: true },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivateKey = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh(await importPublic(uaPublic)), asPrivateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the payload plus the 0x02 "last record" delimiter, no padding.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** VAPID "Authorization" header for the push service of `endpoint`. */
export async function vapidAuthorization(endpoint: string, keys: { publicKey: string; privateKey: string; subject: string }, now = Math.floor(Date.now() / 1000)) {
  const pub = b64u.decode(keys.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: keys.subject })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(signature)}, k=${keys.publicKey}`;
}

export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }
export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/** Sends one notification. Returns the push service's HTTP status (201 = accepted; 404/410 = subscription gone). */
export async function sendPush(sub: PushSubscriptionKeys, message: PushMessage, keys: { publicKey: string; privateKey: string; subject: string }, opts: { ttl?: number; urgency?: "normal" | "high" } = {}) {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl ?? 24 * 3600),
      Urgency: opts.urgency ?? "normal",
      ...(message.tag && { Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) }),
    },
    body,
  });
  return res.status;
}
