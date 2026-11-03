import { describe, expect, it } from "vitest";
import { MCP_TOOLS, toolsFor } from "./mcp";
import type { KeySession } from "./apiKeys";

const key = (role: "admin" | "cashier", readOnly: boolean) => ({ role, apiKey: { id: "k", name: "k", access: readOnly ? "read" : role === "admin" ? "full" : "pos", readOnly } }) as unknown as KeySession;

describe("MCP tools", () => {
  it("have unique names, Spanish descriptions and object schemas", () => {
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(MCP_TOOLS.length);
    for (const t of MCP_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
  it("read-only keys never get tools that change data", () => {
    expect(toolsFor(key("admin", true)).some((t) => t.write)).toBe(false);
    expect(toolsFor(key("admin", false)).some((t) => t.name === "ajustar_existencias")).toBe(true);
  });
  it("a cashier key gets no reports nor stock adjustments, but can move orders", () => {
    const names = toolsFor(key("cashier", false)).map((t) => t.name);
    expect(names).not.toContain("reporte_de_ventas");
    expect(names).not.toContain("ajustar_existencias");
    expect(names).toContain("avanzar_pedido");
  });
});
