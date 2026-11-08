import { describe, expect, it } from "vitest";
import { storeAccountUpdateSchema, storeRegisterSchema, storeSettingsSchema } from "./schemas";

describe("store customer accounts", () => {
  it("sign-up normalizes the email and needs a 10-character password", () => {
    expect(storeRegisterSchema.safeParse({ name: "Ana", email: "ana@example.com", password: "corta" }).success).toBe(false);
    const ok = storeRegisterSchema.parse({ name: " Ana ", email: " ANA@Example.com ", password: "contrasena-1", phone: "" });
    expect(ok).toEqual({ name: "Ana", email: "ana@example.com", password: "contrasena-1", phone: null, acceptsMarketing: false });
  });
  it("profile turns empty fields into null", () => {
    expect(storeAccountUpdateSchema.parse({ name: "Ana", phone: "", address: "  ", acceptsMarketing: true })).toEqual({ name: "Ana", phone: null, address: null, acceptsMarketing: true });
  });
  it("stores ask for an account by default", () => {
    const s = storeSettingsSchema.parse({ enabled: false, pickupEnabled: true, deliveryEnabled: false, payOnDelivery: true, transferEnabled: false });
    expect(s.accountRequired).toBe(true);
  });
});
