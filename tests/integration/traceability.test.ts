import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db";
import { addDaysKey, localDateKey } from "@/lib/tz";
import { allocateOrder, completePicking, confirmDelivery, confirmOrder, createOrder, startPicking } from "@/server/services/orders";
import { confirmStop, createShipment, departShipment, recordTemperature } from "@/server/services/logistics";
import { initiateRecall, searchBatches, traceBatch } from "@/server/services/traceability";
import { batchInShift, makeTenant, produce, type TestTenant } from "./helpers";

let T: TestTenant;
let batchId: string;
let batchCode: string;
let shipmentNumber: string;
let pendingOrderId: string;

beforeAll(async () => {
  T = await makeTenant("Trace Co");
  const { batch, shift } = await batchInShift(T);
  batchId = batch.id;
  batchCode = batch.code;
  await produce(T, shift.id, batch.id, "fillet", 400);
  await produce(T, shift.id, batch.id, "wings", 150);
  const today = localDateKey(new Date(), "Asia/Tashkent");
  const { vehicle, driver } = await withTenant(T.ctx, async (tx) => ({
    vehicle: await tx.vehicle.create({ data: { tenantId: T.tenantId, plate: "01 T 001 TT", type: "REFRIGERATED", capacityKg: 3000 } }),
    driver: await tx.driver.create({ data: { tenantId: T.tenantId, name: "Driver One" } }),
  }));
  const delivered = await withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: today, source: "MANUAL", items: [{ productId: T.products.fillet, quantityKg: 100 }] }));
  await withTenant(T.ctx, async (tx) => {
    await confirmOrder(tx, T.ctx, delivered.id);
    await allocateOrder(tx, T.ctx, delivered.id);
    await startPicking(tx, T.ctx, delivered.id);
    await completePicking(tx, T.ctx, delivered.id);
  });
  const sh = await withTenant(T.ctx, (tx) => createShipment(tx, T.ctx, { vehicleId: vehicle.id, driverId: driver.id, plannedDeparture: new Date(), temperatureMode: "CHILLED", orderIds: [delivered.id] }));
  shipmentNumber = sh.number;
  await withTenant(T.ctx, (tx) => departShipment(tx, T.ctx, sh.id));
  const exc = await withTenant(T.ctx, (tx) => recordTemperature(tx, T.ctx, { sourceType: "VEHICLE", shipmentId: sh.id, temperatureC: 6.5, recordedAt: new Date(), dataSource: "MANUAL" }));
  expect(exc.isExcursion).toBe(true);
  await withTenant(T.ctx, (tx) => confirmStop(tx, T.ctx, { shipmentId: sh.id, orderId: delivered.id, receivedBy: "Receiver" }));
  // a second order that is only reserved (not shipped)
  const pending = await withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: addDaysKey(today, 1), source: "MANUAL", items: [{ productId: T.products.wings, quantityKg: 50 }] }));
  pendingOrderId = pending.id;
  await withTenant(T.ctx, async (tx) => {
    await confirmOrder(tx, T.ctx, pending.id);
    await allocateOrder(tx, T.ctx, pending.id);
  });
});

describe("end-to-end traceability", () => {
  it("finds a batch by code, farm and product", async () => {
    const byCode = await withTenant(T.ctx, (tx) => searchBatches(tx, { text: batchCode }));
    expect(byCode.map((b) => b.id)).toContain(batchId);
    const byFarm = await withTenant(T.ctx, (tx) => searchBatches(tx, { farmId: T.farmId }));
    expect(byFarm.map((b) => b.id)).toContain(batchId);
    const byProduct = await withTenant(T.ctx, (tx) => searchBatches(tx, { productId: T.products.wings }));
    expect(byProduct.map((b) => b.id)).toContain(batchId);
  });

  it("traces farm → receiving → shift → products → inventory → shipment → customer", async () => {
    const tr = (await withTenant(T.ctx, (tx) => traceBatch(tx, batchId)))!;
    expect(tr.batch.farm.code).toBe("FARM001");
    expect(tr.batch.receipt.number).toMatch(/^RCV-/);
    expect(tr.shifts).toHaveLength(1);
    expect(tr.products.map((p) => p.sku).sort()).toEqual(["CH-BRF", "CH-WNG"]);
    expect(tr.inventoryKg).toBeCloseTo(450, 3); // 550 produced − 100 shipped
    expect(tr.customers).toHaveLength(1);
    expect(tr.customers[0].kg).toBeCloseTo(150, 3); // 100 shipped + 50 reserved
    expect(tr.shipments.map((s) => s.number)).toEqual([shipmentNumber]);
    const types = tr.batch.events.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["RECEIVED", "PRODUCTION_INPUT", "PACKAGED", "ALLOCATED", "SHIPPED", "DELIVERED"]));
  });

  it("a recall blocks every lot and releases unshipped allocations", async () => {
    const recall = await withTenant(T.ctx, (tx) => initiateRecall(tx, T.ctx, { batchId, reason: "Suspected contamination in test" }));
    expect(recall.blockedKg).toBeCloseTo(450, 3);
    const lots = await withTenant(T.ctx, (tx) => tx.inventory.findMany({ where: { batchId, quantityKg: { gt: 0 } } }));
    expect(lots.every((l) => l.status === "BLOCKED")).toBe(true);
    expect(lots.every((l) => l.reservedKg === 0)).toBe(true);
    const pendingAlloc = await withTenant(T.ctx, (tx) => tx.orderAllocation.findMany({ where: { orderItem: { orderId: pendingOrderId } } }));
    expect(pendingAlloc.every((a) => a.status === "RELEASED")).toBe(true);
    const b = await withTenant(T.ctx, (tx) => tx.productionBatch.findUniqueOrThrow({ where: { id: batchId } }));
    expect(b.status).toBe("RECALLED");
    await expect(withTenant(T.ctx, (tx) => initiateRecall(tx, T.ctx, { batchId, reason: "Duplicate recall" }))).rejects.toThrow(/already open/);
    // blocked stock can no longer be allocated
    await expect(withTenant(T.ctx, (tx) => allocateOrder(tx, T.ctx, pendingOrderId))).resolves.toMatchObject({ shortageKg: 50 });
  });
});
