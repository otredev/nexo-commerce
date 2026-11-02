import { describe, expect, it } from "vitest";
import { b64u, encryptPayload, vapidAuthorization } from "./webpush";

/** RFC 8291 §5 example. */
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const enc = new TextEncoder();
const concat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const h = async (k: Uint8Array, d: Uint8Array) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
  return (await h(await h(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, n);
}

/** What the browser does: decrypt with the subscription's private key. */
async function decrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string) {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const pub = b64u.decode(uaPublic);
  const priv = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: uaPrivate, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33)), ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []) } as unknown as SubtleCryptoDeriveKeyAlgorithm, priv, 256));
  const ikm = await hkdf(b64u.decode(auth), secret, concat(enc.encode("WebPush: info\0"), pub, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("web push", () => {
  it("matches the RFC 8291 example", async () => {
    const body = await encryptPayload(b64u.decode(RFC.plaintext), RFC.uaPublic, RFC.auth, {
      senderPrivate: b64u.decode(RFC.asPrivate), senderPublic: b64u.decode(RFC.asPublic), salt: b64u.decode(RFC.salt),
    });
    expect(b64u.encode(body)).toBe(RFC.body);
  });
  it("round-trips with a random key and salt", async () => {
    const body = await encryptPayload(enc.encode('{"title":"Pedido nuevo"}'), RFC.uaPublic, RFC.auth);
    expect(await decrypt(body, RFC.uaPrivate, RFC.uaPublic, RFC.auth)).toBe('{"title":"Pedido nuevo"}');
  });
  it("signs a VAPID JWT the push service can verify", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const publicKey = b64u.encode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { publicKey, privateKey: jwk.d!, subject: "mailto:a@b.mx" }, 1_800_000_000);
    const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(publicKey);
    const [h, c, s] = t!.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64u.decode(c!)))).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 43200, sub: "mailto:a@b.mx" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64u.decode(s!), enc.encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});
