import { describe, expect, it } from "vitest";
import { customerStatusLabel, displayPrice, shippingFor } from "./store";

describe("store helpers", () => {
  it("shows prices with tax", () => {
    expect(displayPrice(11600, 1600, true)).toBe(11600);
    expect(displayPrice(10000, 1600, false)).toBe(11600);
    expect(displayPrice(999, 0, false)).toBe(999);
  });
  it("charges delivery until the free threshold", () => {
    const rules = { deliveryFeeCents: 5000, freeDeliveryFromCents: 50000 };
    expect(shippingFor(rules, 49999, "delivery")).toBe(5000);
    expect(shippingFor(rules, 50000, "delivery")).toBe(0);
    expect(shippingFor(rules, 100, "pickup")).toBe(0);
    expect(shippingFor({ deliveryFeeCents: 3000, freeDeliveryFromCents: null }, 10_000_000, "delivery")).toBe(3000);
  });
  it("words the status for the customer", () => {
    expect(customerStatusLabel("ready", "pickup")).toBe("Listo para recoger");
    expect(customerStatusLabel("ready", "delivery")).toBe("En camino");
  });
});

describe("whatsappLink", () => {
  it("adds +52 to 10-digit numbers and keeps country codes", async () => {
    const { whatsappLink } = await import("./store");
    expect(whatsappLink("951 123 4567")).toBe("https://wa.me/529511234567");
    expect(whatsappLink("+1 (415) 555-0100", "Hola")).toBe("https://wa.me/14155550100?text=Hola");
  });
});
