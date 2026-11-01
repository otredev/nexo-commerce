import { describe, expect, it } from "vitest";
import { hashPassword, newId, randomToken, verifyPassword } from "./crypto";
import { slugify } from "./tenant";

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correcto-caballo-bateria");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("correcto-caballo-bateria", hash)).toBe(true);
    expect(await verifyPassword("otra-cosa", hash)).toBe(false);
  });

  it("uses a different salt every time", async () => {
    expect(await hashPassword("x".repeat(12))).not.toBe(await hashPassword("x".repeat(12)));
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("a", "nope")).toBe(false);
  });
});

describe("ids and tokens", () => {
  it("creates sortable ids", async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 2));
    const b = newId();
    expect(a).toHaveLength(26);
    expect(a < b).toBe(true);
  });

  it("creates url-safe tokens", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("slugify", () => {
  it("normalizes business names", () => {
    expect(slugify("Café & Panadería Olivo")).toBe("cafe-panaderia-olivo");
    expect(slugify("¡¡!!")).toBe("negocio");
  });
});
