import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db";
import { adjustStock, completeStocktake, createStocktake, saveStocktakeCounts, setLotStatus, transferStock, writeOff } from "@/server/services/inventory";
import { recordSale } from "@/server/services/retail";
import { batchInShift, makeTenant, produce, type TestTenant } from "./helpers";

let T: TestTenant;
let lotId: string;
let distWh: string;
let distChilled: string;

beforeAll(async () => {
  T = await makeTenant("Inventory Co");
  const { batch, shift } = await batchInShift(T);
  lotId = (await produce(T, shift.id, batch.id, "fillet", 300)).inventoryId!;
  ({ distWh, distChilled } = await withTenant(T.ctx, async (tx) => {
    const w = await tx.warehouse.create({ data: { tenantId: T.tenantId, code: "DC", name: "DC", type: "DISTRIBUTION" } });
    const c = await tx.storageChamber.create({ data: { tenantId: T.tenantId, warehouseId: w.id, code: "DC-C", name: "DC chilled", type: "CHILLED" } });
    return { distWh: w.id, distChilled: c.id };
  }));
});

const total = () => withTenant(T.ctx, (tx) => tx.inventory.aggregate({ where: { productId: T.products.fillet }, _sum: { quantityKg: true } })).then((a) => a._sum.quantityKg ?? 0);

describe("inventory movements", () => {
  it("transfers conserve quantity and keep batch/expiry", async () => {
    const before = await total();
    const tr = await withTenant(T.ctx, (tx) => transferStock(tx, T.ctx, { toWarehouseId: distWh, toChamberId: distChilled, lines: [{ inventoryId: lotId, quantityKg: 100 }] }));
    expect(await total()).toBeCloseTo(before, 6);
    const dest = await withTenant(T.ctx, (tx) => tx.inventory.findFirstOrThrow({ where: { warehouseId: distWh } }));
    const src = await withTenant(T.ctx, (tx) => tx.inventory.findUniqueOrThrow({ where: { id: lotId } }));
    expect(dest.quantityKg).toBe(100);
    expect(src.quantityKg).toBe(200);
    expect(dest.expiryDate.getTime()).toBe(src.expiryDate.getTime());
    expect(dest.batchId).toBe(src.batchId);
    const mv = await withTenant(T.ctx, (tx) => tx.inventoryMovement.findMany({ where: { referenceId: tr.id } }));
    expect(mv.map((m) => m.type).sort()).toEqual(["TRANSFER_IN", "TRANSFER_OUT"]);
    await expect(withTenant(T.ctx, (tx) => transferStock(tx, T.ctx, { toWarehouseId: distWh, lines: [{ inventoryId: lotId, quantityKg: 1000 }] }))).rejects.toThrow(/Insufficient stock/);
  });

  it("write-offs and adjustments are recorded and audited", async () => {
    await withTenant(T.ctx, (tx) => writeOff(tx, T.ctx, { inventoryId: lotId, quantityKg: 10, type: "DAMAGE", reason: "Torn packaging" }));
    await withTenant(T.ctx, (tx) => adjustStock(tx, T.ctx, { inventoryId: lotId, newQuantityKg: 185, reason: "Recount" }));
    const lot = await withTenant(T.ctx, (tx) => tx.inventory.findUniqueOrThrow({ where: { id: lotId } }));
    expect(lot.quantityKg).toBe(185);
    const mv = await withTenant(T.ctx, (tx) => tx.inventoryMovement.findMany({ where: { inventoryId: lotId }, orderBy: { createdAt: "asc" } }));
    expect(mv.map((m) => m.type)).toEqual(expect.arrayContaining(["PRODUCTION_IN", "TRANSFER_OUT", "DAMAGE", "ADJUSTMENT"]));
    // movement history reconciles to the lot balance
    expect(mv.reduce((s, m) => s + m.quantityKg, 0)).toBeCloseTo(185, 6);
    const audit = await withTenant(T.ctx, (tx) => tx.auditLog.findMany({ where: { entityId: lotId } }));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["inventory.write_off", "inventory.adjust"]));
  });

  it("blocked stock cannot be transferred or sold", async () => {
    await withTenant(T.ctx, (tx) => setLotStatus(tx, T.ctx, { inventoryId: lotId, status: "BLOCKED", reason: "Lab test pending" }));
    await expect(withTenant(T.ctx, (tx) => transferStock(tx, T.ctx, { toWarehouseId: distWh, lines: [{ inventoryId: lotId, quantityKg: 1 }] }))).rejects.toThrow(/not available/);
    await withTenant(T.ctx, (tx) => setLotStatus(tx, T.ctx, { inventoryId: lotId, status: "AVAILABLE", reason: "Lab OK" }));
  });

  it("stocktake posts variances against the snapshot", async () => {
    const st = await withTenant(T.ctx, (tx) => createStocktake(tx, T.ctx, { warehouseId: distWh }));
    await expect(withTenant(T.ctx, (tx) => createStocktake(tx, T.ctx, { warehouseId: distWh }))).rejects.toThrow(/already open/);
    const lines = await withTenant(T.ctx, (tx) => tx.stocktakeLine.findMany({ where: { stocktakeId: st.id } }));
    expect(lines).toHaveLength(1);
    await expect(withTenant(T.ctx, (tx) => completeStocktake(tx, T.ctx, st.id))).rejects.toThrow(/not been counted/);
    await withTenant(T.ctx, (tx) => saveStocktakeCounts(tx, T.ctx, st.id, { [lines[0].id]: 97.5 }));
    const adjusted = await withTenant(T.ctx, (tx) => completeStocktake(tx, T.ctx, st.id));
    expect(adjusted).toBe(1);
    const lot = await withTenant(T.ctx, (tx) => tx.inventory.findUniqueOrThrow({ where: { id: lines[0].inventoryId } }));
    expect(lot.quantityKg).toBe(97.5);
  });

  it("retail sales consume store stock FEFO and refuse to oversell", async () => {
    const store = await withTenant(T.ctx, async (tx) => {
      const w = await tx.warehouse.create({ data: { tenantId: T.tenantId, code: "S1W", name: "Store 1", type: "RETAIL" } });
      const c = await tx.storageChamber.create({ data: { tenantId: T.tenantId, warehouseId: w.id, code: "S1C", name: "Display", type: "CHILLED" } });
      const loc = await tx.retailLocation.create({ data: { tenantId: T.tenantId, code: "S1", name: "Store 1", warehouseId: w.id } });
      return { w, c, loc };
    });
    await withTenant(T.ctx, (tx) => transferStock(tx, T.ctx, { toWarehouseId: store.w.id, toChamberId: store.c.id, lines: [{ inventoryId: lotId, quantityKg: 20 }] }));
    const sales = await withTenant(T.ctx, (tx) => recordSale(tx, T.ctx, { retailLocationId: store.loc.id, productId: T.products.fillet, quantityKg: 12, cashierName: "Cashier 1" }));
    expect(sales.reduce((s, x) => s + x.quantityKg, 0)).toBeCloseTo(12, 6);
    expect(Number(sales[0].unitPrice)).toBe(58000);
    await expect(withTenant(T.ctx, (tx) => recordSale(tx, T.ctx, { retailLocationId: store.loc.id, productId: T.products.fillet, quantityKg: 9 }))).rejects.toThrow(/Insufficient stock/);
  });
});
