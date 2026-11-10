import { describe, expect, it } from "vitest";
import { deviceLabel, displaySignupMessageSchema, firstNameOf, NOTIFICATION_EVENTS } from "./notifications";
import { can } from "./roles";

describe("deviceLabel", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "iPhone · Safari"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Android · Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "Windows · Edge"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5; rv:131.0) Gecko/20100101 Firefox/131.0", "Mac · Firefox"],
    ["curl/8.0", "Dispositivo · Navegador"],
  ])("%s", (ua, label) => expect(deviceLabel(ua)).toBe(label));
});

describe("notification events", () => {
  it("cashiers get orders and the digest, never billing", () => {
    const forCashier = NOTIFICATION_EVENTS.filter((e) => can("cashier", e.permission)).map((e) => e.id);
    expect(forCashier).toEqual(["order_new", "order_paid", "daily_digest"]);
    expect(NOTIFICATION_EVENTS.every((e) => can("owner", e.permission))).toBe(true);
  });
});

describe("customer display sign-up message", () => {
  const ok = (m: unknown) => displaySignupMessageSchema.safeParse(m).success;
  it("accepts a sign-up with a phone or an email, and «not now»", () => {
    expect(ok({ type: "signup", id: "abc123def", name: "Ana López", phone: "+1 305 555 0101", email: "" })).toBe(true);
    expect(ok({ type: "signup", id: "abc123def", name: "Ana", email: "ANA@Example.com", acceptsMarketing: true })).toBe(true);
    expect(displaySignupMessageSchema.parse({ type: "signup", id: "abc123def", name: "Ana", email: "ANA@Example.com" })).toMatchObject({ email: "ana@example.com", phone: null, acceptsMarketing: false });
    expect(ok({ type: "signup_skip", id: "abc123def" })).toBe(true);
  });
  it("rejects anything else", () => {
    expect(ok({ type: "signup", id: "abc123def", name: "Ana" })).toBe(false); // no phone nor email
    expect(ok({ type: "signup", id: "abc123def", name: "A", phone: "5551234" })).toBe(false);
    expect(ok({ type: "signup", id: "abc123def", name: "Ana", phone: "<script>" })).toBe(false);
    expect(ok({ type: "signup", id: "bad id!", name: "Ana", phone: "5551234" })).toBe(false);
    expect(ok({ type: "signup", id: "abc123def", name: "Ana", phone: "5551234", notes: "extra" })).toBe(false);
    expect(ok({ type: "sale", id: "abc123def" })).toBe(false);
    expect(ok("hello")).toBe(false);
  });
  it("shows only the first name", () => {
    expect(firstNameOf("  Ana María López ")).toBe("Ana");
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
