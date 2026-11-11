import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/db";
import { makeTenant, receiptInput, type TestTenant } from "./helpers";
import { createReceipt } from "@/server/services/receiving";

let A: TestTenant;
let B: TestTenant;

beforeAll(async () => {
  A = await makeTenant("Tenant A");
  B = await makeTenant("Tenant B");
  await withTenant(B.ctx, (tx) => createReceipt(tx, B.ctx, receiptInput(B), { batchFormat: B.batchFormat, batchPrefix: B.batchPrefix }));
});

describe("tenant isolation (PostgreSQL row-level security)", () => {
  it("returns only the current tenant's rows even without a where-filter", async () => {
    const aSuppliers = await withTenant(A.ctx, (tx) => tx.supplier.findMany());
    expect(aSuppliers.length).toBe(1);
    expect(aSuppliers.every((s) => s.tenantId === A.tenantId)).toBe(true);
    const aBatches = await withTenant(A.ctx, (tx) => tx.productionBatch.findMany());
    expect(aBatches).toHaveLength(0); // B has a batch, A has none
  });

  it("cannot read another tenant's record by primary key", async () => {
    const leaked = await withTenant(A.ctx, (tx) => tx.supplier.findUnique({ where: { id: B.supplierId } }));
    expect(leaked).toBeNull();
    const leakedCustomer = await withTenant(A.ctx, (tx) => tx.customer.findFirst({ where: { id: B.customerId } }));
    expect(leakedCustomer).toBeNull();
  });

  it("cannot update or delete another tenant's rows", async () => {
    const upd = await withTenant(A.ctx, (tx) => tx.supplier.updateMany({ where: { id: B.supplierId }, data: { name: "hijacked" } }));
    expect(upd.count).toBe(0);
    const del = await withTenant(A.ctx, (tx) => tx.customer.deleteMany({ where: { id: B.customerId } }));
    expect(del.count).toBe(0);
    const stillThere = await withTenant(B.ctx, (tx) => tx.supplier.findUnique({ where: { id: B.supplierId } }));
    expect(stillThere?.name).not.toBe("hijacked");
  });

  it("rejects inserting rows that claim another tenant", async () => {
    await expect(withTenant(A.ctx, (tx) => tx.supplier.create({ data: { tenantId: B.tenantId, code: "EVIL", name: "Injected" } }))).rejects.toThrow();
  });

  it("denies everything when no tenant context is set (default deny)", async () => {
    const rows = await prisma.supplier.findMany();
    expect(rows).toHaveLength(0);
    const tenants = await prisma.tenant.findMany();
    expect(tenants).toHaveLength(0);
  });

  it("raw SQL is also filtered by RLS", async () => {
    const rows = await withTenant(A.ctx, (tx) => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM suppliers`);
    expect(rows[0].n).toBe(1);
  });
});
