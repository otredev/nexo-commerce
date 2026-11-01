import { describe, expect, it } from "vitest";
import { formEncode, signStripePayload, verifyStripeSignature } from "./stripe";

describe("stripe helpers", () => {
  it("encodes nested params with brackets", () => {
    const s = formEncode({ mode: "payment", line_items: [{ price: "p_1", quantity: 1 }], metadata: { order_id: "o 1" }, skip: null });
    expect(s).toEqual(["mode=payment", "line_items%5B0%5D%5Bprice%5D=p_1", "line_items%5B0%5D%5Bquantity%5D=1", "metadata%5Border_id%5D=o%201"]);
  });
  it("verifies signatures, rejecting tampering and old events", async () => {
    const body = '{"id":"evt_1"}';
    const header = await signStripePayload(body, "whsec_a");
    expect(await verifyStripeSignature(body, header, ["whsec_a"])).toBe(true);
    expect(await verifyStripeSignature(body, header, [undefined, "whsec_b", "whsec_a"])).toBe(true);
    expect(await verifyStripeSignature(body + " ", header, ["whsec_a"])).toBe(false);
    expect(await verifyStripeSignature(body, header, ["whsec_b"])).toBe(false);
    const old = await signStripePayload(body, "whsec_a", Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyStripeSignature(body, old, ["whsec_a"])).toBe(false);
    expect(await verifyStripeSignature(body, undefined, ["whsec_a"])).toBe(false);
  });
});
