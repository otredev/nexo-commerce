import { describe, expect, it } from "vitest";
import { signWebhook } from "./outbound";

const hmacHex = async (secret: string, data: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

describe("webhook signature", () => {
  it("is HMAC-SHA256 of t.body (the receiver can verify it with any library)", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "order.created", data: { total: 100, nombre: "Pedro Ñandú" } });
    const header = await signWebhook("whsec_test", body, 1_800_000_000);
    expect(header).toBe(`t=1800000000,v1=${await hmacHex("whsec_test", `1800000000.${body}`)}`);
    // Known vector (RFC 4231-style check of the plumbing): HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog").
    expect(await hmacHex("key", "The quick brown fox jumps over the lazy dog")).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});
