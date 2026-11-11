import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db";
import { addShiftInput, addShiftOutput, closeShift, computeShiftMetrics } from "@/server/services/production";
import { batchInShift, makeTenant, produce, receiptInput, type TestTenant } from "./helpers";
import { createReceipt } from "@/server/services/receiving";

let T: TestTenant;
beforeAll(async () => {
  T = await makeTenant("Production Co");
});

describe("yield formulas", () => {
  it("computes total yield, product yield, waste and unexplained difference", () => {
    const m = computeShiftMetrics({
      inputs: [{ batchId: "b1", inputWeightKg: 1000, birdsProcessed: 400 }],
      outputs: [
        { batchId: "b1", outputType: "PRODUCT", productId: "fillet", weightKg: 210 },
        { batchId: "b1", outputType: "PRODUCT", productId: "carcass", weightKg: 490 },
        { batchId: "b1", outputType: "BYPRODUCT", productId: "liver", weightKg: 70 },
        { batchId: "b1", outputType: "WASTE", productId: null, weightKg: 200 },
      ],
      tolerancePct: 3,
      plannedInputKg: 1100,
    });
    expect(m.totalYieldPct).toBeCloseTo(77, 6); // (700 + 70) / 1000
    expect(m.wastePct).toBeCloseTo(20, 6);
    expect(m.unexplainedKg).toBeCloseTo(30, 6);
    expect(m.unexplainedPct).toBeCloseTo(3, 6);
    expect(m.massBalanceFlag).toBe(false); // exactly at tolerance
    expect(m.productYields.find((p) => p.productId === "fillet")!.yieldPct).toBeCloseTo(21, 6);
    expect(m.avgBirdKg).toBe(2.5);
    expect(m.planInputVariancePct).toBeCloseTo(-9.0909, 3);
  });

  it("flags an unexplained difference above tolerance", () => {
    const m = computeShiftMetrics({ inputs: [{ batchId: "b", inputWeightKg: 1000, birdsProcessed: 400 }], outputs: [{ batchId: "b", outputType: "PRODUCT", productId: "p", weightKg: 900 }], tolerancePct: 3 });
    expect(m.unexplainedPct).toBeCloseTo(10, 6);
    expect(m.massBalanceFlag).toBe(true);
  });
});

describe("shift operations", () => {
  it("rejects processing more birds or weight than the batch holds", async () => {
    const { batch } = await withTenant(T.ctx, (tx) => createReceipt(tx, T.ctx, receiptInput(T), { batchFormat: T.batchFormat, batchPrefix: T.batchPrefix }));
    const shift = await withTenant(T.ctx, (tx) => tx.productionShift.findFirst({ where: { status: "OPEN" } })) ?? (await batchInShift(T)).shift;
    await expect(withTenant(T.ctx, (tx) => addShiftInput(tx, T.ctx, { shiftId: shift.id, batchId: batch.id, birdsProcessed: 1001, inputWeightKg: 2500 }))).rejects.toThrow(/Only 1000 birds/);
    await expect(withTenant(T.ctx, (tx) => addShiftInput(tx, T.ctx, { shiftId: shift.id, batchId: batch.id, birdsProcessed: 100, inputWeightKg: 2600 }))).rejects.toThrow(/exceeds the remaining live weight/);
    await expect(withTenant(T.ctx, (tx) => addShiftInput(tx, T.ctx, { shiftId: shift.id, batchId: batch.id, birdsProcessed: 100, inputWeightKg: 900 }))).rejects.toThrow(/implausible/);
  });

  it("records outputs into inventory with shelf-life expiry and blocks impossible mass balance", async () => {
    const { batch, shift } = await batchInShift(T);
    const out = await produce(T, shift.id, batch.id, "fillet", 500);
    const lot = await withTenant(T.ctx, (tx) => tx.inventory.findUniqueOrThrow({ where: { id: out.inventoryId! } }));
    expect(lot.quantityKg).toBe(500);
    expect(lot.expiryDate.getTime() - lot.productionDate.getTime()).toBe(72 * 3600000);
    expect(lot.batchId).toBe(batch.id);
    const pack = await withTenant(T.ctx, (tx) => tx.packagingRecord.findFirst({ where: { outputId: out.output.id } }));
    expect(pack?.netWeightKg).toBe(500);
    // 2500 kg input: 500 recorded, 2001 more would exceed
    await expect(produce(T, shift.id, batch.id, "wings", 2001)).rejects.toThrow(/Impossible mass balance/);
    // frozen product cannot go to a chilled chamber
    await expect(
      withTenant(T.ctx, (tx) => addShiftOutput(tx, T.ctx, { shiftId: shift.id, batchId: batch.id, outputType: "PRODUCT", productId: T.products.frozen, weightKg: 10, warehouseId: T.warehouseId, chamberId: T.chilledChamberId })),
    ).rejects.toThrow(/freezer/);
    // waste requires a valid category
    await expect(withTenant(T.ctx, (tx) => addShiftOutput(tx, T.ctx, { shiftId: shift.id, batchId: batch.id, outputType: "WASTE", wasteCategory: "Bogus", weightKg: 5 }))).rejects.toThrow(/waste category/);
  });

  it("closing a shift with a large unexplained difference raises a mass-balance alert", async () => {
    const { batch, shift } = await batchInShift(T);
    // this shift may already contain earlier batches; record outputs only for part of this batch
    await produce(T, shift.id, batch.id, "wings", 1000);
    const m = await withTenant(T.ctx, (tx) => closeShift(tx, T.ctx, shift.id));
    expect(m.massBalanceFlag).toBe(true);
    const alert = await withTenant(T.ctx, (tx) => tx.notification.findFirst({ where: { type: "MASS_BALANCE", entityId: shift.id } }));
    expect(alert).not.toBeNull();
    const b = await withTenant(T.ctx, (tx) => tx.productionBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    expect(b.status).toBe("COMPLETED");
    await expect(produce(T, shift.id, batch.id, "wings", 1)).rejects.toThrow(/closed/);
  });
});
