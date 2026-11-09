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
  it("appearance: read tools for read-only keys, changes only with a full key, code marked destructive", () => {
    const ro = toolsFor(key("admin", true)).map((t) => t.name);
    expect(ro).toEqual(expect.arrayContaining(["ver_apariencia", "ver_seccion", "ver_codigo_tienda"]));
    expect(ro).not.toContain("editar_seccion");
    expect(ro).not.toContain("editar_codigo_tienda");
    const full = toolsFor(key("admin", false)).map((t) => t.name);
    expect(full).toEqual(expect.arrayContaining(["cambiar_tema", "barra_de_avisos", "agregar_seccion", "editar_seccion", "ordenar_secciones", "editar_codigo_tienda"]));
    expect(full).not.toContain("editar_banner");
    expect(MCP_TOOLS.find((t) => t.name === "editar_codigo_tienda")?.destructive).toBe(true);
    const cashier = toolsFor(key("cashier", false)).map((t) => t.name);
    expect(cashier).not.toContain("editar_codigo_tienda");
    expect(cashier).not.toContain("cambiar_tema");
    expect(cashier).not.toContain("agregar_seccion");
  });
  it("every required argument is declared, and every tool that deletes or cancels is marked destructive", () => {
    for (const t of MCP_TOOLS) {
      const props = Object.keys((t.inputSchema.properties ?? {}) as object);
      for (const r of (t.inputSchema.required as string[]) ?? []) expect(props, `${t.name}.${r}`).toContain(r);
      if (/^(eliminar|cancelar_(traspaso|compra)|terminar_conteo)/.test(t.name)) expect(t.destructive, t.name).toBe(true);
      if (t.destructive) expect(t.write, t.name).toBe(true);
    }
  });
  it("catalog, inventory and store: reads for read-only keys, changes with a full key", () => {
    const ro = toolsFor(key("admin", true)).map((t) => t.name);
    expect(ro).toEqual(expect.arrayContaining(["listar_categorias", "listar_marcas", "listar_impuestos", "movimientos_inventario", "listar_traspasos", "listar_compras", "listar_promociones", "ver_ajustes_tienda"]));
    expect(ro.some((n) => /^(crear|editar|eliminar|guardar|subir|recibir|capturar)_/.test(n))).toBe(false);
    const full = toolsFor(key("admin", false)).map((t) => t.name);
    expect(full).toEqual(expect.arrayContaining([
      "crear_producto", "editar_producto", "archivar_producto", "eliminar_producto", "crear_categoria", "editar_categoria", "eliminar_categoria", "crear_marca", "editar_marca",
      "eliminar_marca", "guardar_impuesto", "subir_imagen", "crear_traspaso", "recibir_traspaso", "crear_conteo", "capturar_conteo", "terminar_conteo", "crear_proveedor",
      "crear_compra", "recibir_compra", "guardar_promocion", "guardar_cupon", "pixeles", "editar_ajustes_tienda",
    ]));
    const cashier = toolsFor(key("cashier", false)).map((t) => t.name);
    expect(cashier).toContain("capturar_conteo");
    expect(cashier).not.toContain("crear_producto");
    expect(cashier).not.toContain("terminar_conteo");
  });
});
