import { describe, expect, it } from "vitest";
import { deviceLabel, NOTIFICATION_EVENTS } from "./notifications";
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
