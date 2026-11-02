import { describe, expect, it } from "vitest";
import { deviceOf, referrerHost } from "./events";

describe("store events", () => {
  it("classifies devices", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130")).toBe("desktop");
  });
  it("keeps only external referrer hosts", () => {
    expect(referrerHost("https://www.google.com/search?q=x", ["tienda.example.com"])).toBe("google.com");
    expect(referrerHost("https://tienda.example.com/otra", ["tienda.example.com"])).toBe("");
    expect(referrerHost("no es url", [])).toBe("");
    expect(referrerHost(null, [])).toBe("");
  });
});
