import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ASSIGNABLE_PERMISSIONS, effectivePermissions, PERMISSION_GROUPS, rolePermissions } from "./roles";
import { customRoleSchema } from "./schemas";
import { operatorPermissions, PLATFORM_PERMISSIONS, PLATFORM_PRESETS } from "./platform";

describe("permissions", () => {
  it("the role editor lists every assignable permission exactly once (not the owner's plan and payments)", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...ASSIGNABLE_PERMISSIONS].sort());
    expect(ALL_PERMISSIONS.length).toBe(ASSIGNABLE_PERMISSIONS.length + 1);
  });
  it("the owner has everything; custom roles never get owner-only permissions", () => {
    expect(effectivePermissions("owner", ["pos:sell"])).toEqual(rolePermissions("owner"));
    expect(effectivePermissions("cashier", ["pos:sell", "billing:write", "nope"])).toEqual(["pos:sell"]);
    expect(ASSIGNABLE_PERMISSIONS).not.toContain("billing:write");
  });
  it("without a custom role, the built-in role applies", () => {
    expect(effectivePermissions("cashier", null)).toEqual(rolePermissions("cashier"));
    expect(rolePermissions("cashier")).not.toContain("cash:review");
    expect(rolePermissions("admin")).toContain("cash:review");
  });
  it("a custom role keeps only known permissions and needs at least one", () => {
    expect(customRoleSchema.safeParse({ name: "X", permissions: ["nope"] }).success).toBe(false);
    expect(customRoleSchema.parse({ name: " Almacén ", permissions: ["inventory:read", "billing:write"] })).toEqual({ name: "Almacén", description: null, permissions: ["inventory:read"] });
  });
  it("operators: * means everything; presets only use real permissions", () => {
    expect(operatorPermissions(["*"])).toEqual(PLATFORM_PERMISSIONS);
    expect(operatorPermissions(["support:read", "nope"])).toEqual(["support:read"]);
    for (const p of Object.values(PLATFORM_PRESETS)) expect(p.permissions.every((x) => PLATFORM_PERMISSIONS.includes(x))).toBe(true);
  });
});
