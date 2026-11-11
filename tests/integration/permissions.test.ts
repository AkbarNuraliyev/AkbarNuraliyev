import { describe, expect, it } from "vitest";
import { effectivePermissions, ROLE_TEMPLATES } from "@/lib/roles";
import { PLAN_DEFAULT_FEATURES } from "@/lib/modules";
import { withTenant } from "@/lib/db";
import { makeTenant } from "./helpers";
import { assertWithinLimit } from "@/server/services/billing";
import { createInvitation } from "@/server/services/users";

const role = (k: string) => ROLE_TEMPLATES.find((r) => r.key === k)!;

describe("role-based access control", () => {
  it("owner has every permission including billing; admin has everything except billing", () => {
    const owner = effectivePermissions(role("OWNER").permissions, false, null);
    const admin = effectivePermissions(role("ADMIN").permissions, false, null);
    expect(owner.has("settings.billing")).toBe(true);
    expect(admin.has("settings.billing")).toBe(false);
    expect(admin.has("production.manage")).toBe(true);
  });

  it("department-scoped employee only gets modules of their department", () => {
    const warehouse = ["inventory", "products"];
    const p = effectivePermissions(role("EMPLOYEE").permissions, true, warehouse);
    expect(p.has("inventory.view")).toBe(true);
    expect(p.has("inventory.operate")).toBe(true);
    expect(p.has("inventory.manage")).toBe(false); // employees cannot manage
    expect(p.has("production.view")).toBe(false);
    expect(p.has("orders.view")).toBe(false);
    expect(p.has("overview.view")).toBe(true);
    expect(p.has("traceability.view")).toBe(true);
  });

  it("department manager manages own department, reads reports, cannot recall unless Quality", () => {
    const prod = effectivePermissions(role("MANAGER").permissions, true, ["production", "products", "receiving"]);
    expect(prod.has("production.manage")).toBe(true);
    expect(prod.has("reports.view")).toBe(true);
    expect(prod.has("logistics.view")).toBe(false);
    expect(prod.has("traceability.recall")).toBe(false);
    const quality = effectivePermissions(role("MANAGER").permissions, true, ["quality", "receiving", "traceability"]);
    expect(quality.has("traceability.recall")).toBe(true);
  });

  it("portal role has no back-office permissions", () => {
    expect(role("CUSTOMER").permissions).toHaveLength(0);
    expect(role("CUSTOMER").isPortal).toBe(true);
  });

  it("plans gate modules: Starter excludes production and API", () => {
    expect(PLAN_DEFAULT_FEATURES.STARTER).not.toContain("production");
    expect(PLAN_DEFAULT_FEATURES.STARTER).not.toContain("api");
    expect(PLAN_DEFAULT_FEATURES.GROWTH).toContain("production");
    expect(PLAN_DEFAULT_FEATURES.ENTERPRISE).toContain("api");
  });
});

describe("plan usage limits", () => {
  it("Starter allows one warehouse and five users", async () => {
    const t = await makeTenant("Starter Co", "STARTER");
    await expect(withTenant(t.ctx, (tx) => assertWithinLimit(tx, t.tenantId, "warehouses"))).rejects.toThrow(/allows 1 warehouses/);
    await expect(withTenant(t.ctx, (tx) => assertWithinLimit(tx, t.tenantId, "retail"))).rejects.toThrow(/allows 0 retail/);
    // owner is 1 user; 4 more invitations fit, the 5th extra does not
    for (let i = 0; i < 4; i++) {
      await withTenant(t.ctx, async (tx) => {
        const r = await tx.role.findFirstOrThrow({ where: { key: "ADMIN" } });
        await createInvitation(tx, t.ctx, { email: `u${i}@starter.test`, roleId: r.id, tenantName: "Starter Co" });
      });
    }
    await expect(
      withTenant(t.ctx, async (tx) => {
        const r = await tx.role.findFirstOrThrow({ where: { key: "ADMIN" } });
        await createInvitation(tx, t.ctx, { email: "u5@starter.test", roleId: r.id, tenantName: "Starter Co" });
      }),
    ).rejects.toThrow(/allows 5 users/);
  });

  it("department-scoped invitation requires a department; owner role cannot be invited", async () => {
    const t = await makeTenant("Invite Co");
    await expect(
      withTenant(t.ctx, async (tx) => {
        const r = await tx.role.findFirstOrThrow({ where: { key: "EMPLOYEE" } });
        await createInvitation(tx, t.ctx, { email: "e@x.test", roleId: r.id, tenantName: "x" });
      }),
    ).rejects.toThrow(/department/);
    await expect(
      withTenant(t.ctx, async (tx) => {
        const r = await tx.role.findFirstOrThrow({ where: { key: "OWNER" } });
        await createInvitation(tx, t.ctx, { email: "o@x.test", roleId: r.id, tenantName: "x" });
      }),
    ).rejects.toThrow(/owner role/);
  });
});
