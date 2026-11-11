import { describe, expect, it } from "vitest";
import { toE164 } from "./sms";
import { openSecret, sealSecret } from "./secrets";

describe("toE164", () => {
  it.each([
    ["(305) 555-0142", "USD", "+13055550142"],
    ["1 305 555 0142", "USD", "+13055550142"],
    ["+52 55 1234 5678", "USD", "+525512345678"],
    ["55 1234 5678", "MXN", "+525512345678"],
    ["555-01", "USD", null],
    ["+1", "USD", null],
  ])("%s (%s) → %s", (raw, cur, out) => expect(toE164(raw, cur)).toBe(out));
});

describe("secrets", () => {
  const env = { APP_ENV: "development" as const, SECRETS_KEY: btoa("0123456789abcdef0123456789abcdef") };
  it("round-trips and is bound to the business", async () => {
    const sealed = await sealSecret(env, "tenant-a", "tok_123456789012345678901234");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("tok_");
    expect(await openSecret(env, "tenant-a", sealed)).toBe("tok_123456789012345678901234");
    await expect(openSecret(env, "tenant-b", sealed)).rejects.toThrow();
  });
  it("needs a key outside development", async () => {
    await expect(sealSecret({ APP_ENV: "production" }, "t", "x")).rejects.toThrow(/SECRETS_KEY/);
  });
});
