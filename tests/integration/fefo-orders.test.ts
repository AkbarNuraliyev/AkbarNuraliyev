import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db";
import { num } from "@/lib/format";
import { addDaysKey, localDateKey } from "@/lib/tz";
import { addStock, fefoCandidates, planFefo } from "@/server/services/inventory";
import { allocateOrder, cancelOrder, completePicking, confirmDelivery, confirmOrder, createOrder, dispatchOrder, startPicking } from "@/server/services/orders";
import { batchInShift, makeTenant, type TestTenant } from "./helpers";

let T: TestTenant;
let batchId: string;
const H = 3600000;
const tomorrow = () => addDaysKey(localDateKey(new Date(), "Asia/Tashkent"), 1);

/** Creates fillet lots with controlled expiry dates (simulating production on different days). */
async function lot(kg: number, expiresInHours: number) {
  const now = Date.now();
  return withTenant(T.ctx, (tx) =>
    addStock(tx, T.ctx, {
      productId: T.products.fillet,
      batchId,
      warehouseId: T.warehouseId,
      chamberId: T.chilledChamberId,
      productionDate: new Date(now - (72 - expiresInHours) * H),
      expiryDate: new Date(now + expiresInHours * H),
      quantityKg: kg,
      type: "PRODUCTION_IN",
    }),
  );
}

beforeAll(async () => {
  T = await makeTenant("FEFO Co");
  ({ batch: { id: batchId } } = await batchInShift(T));
});

describe("FEFO allocation", () => {
  it("plans the earliest-expiring lots first and reports shortage", () => {
    const now = Date.now();
    const plan = planFefo(
      [
        { id: "a", batchId: "x", expiryDate: new Date(now + 10 * H), free: 30 },
        { id: "b", batchId: "x", expiryDate: new Date(now + 40 * H), free: 50 },
        { id: "c", batchId: "x", expiryDate: new Date(now + 70 * H), free: 100 },
      ],
      100,
    );
    expect(plan.picks.map((p) => [p.inventoryId, p.quantityKg])).toEqual([["a", 30], ["b", 50], ["c", 20]]);
    expect(plan.shortageKg).toBe(0);
    expect(planFefo([{ id: "a", batchId: "x", expiryDate: new Date(), free: 10 }], 25).shortageKg).toBe(15);
  });

  it("allocates an order FEFO, skipping lots that expire before the delivery day ends", async () => {
    const soon = await lot(40, 6); // expires today → not valid for tomorrow's delivery
    const mid = await lot(60, 40);
    const late = await lot(200, 70);
    const cands = await withTenant(T.ctx, (tx) => fefoCandidates(tx, { productId: T.products.fillet, mustBeValidUntil: new Date(Date.now() + 30 * H) }));
    expect(cands.map((c) => c.id)).not.toContain(soon.id);

    const order = await withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: tomorrow(), source: "MANUAL", items: [{ productId: T.products.fillet, quantityKg: 100 }] }));
    // contract price from the customer's price list (55 000), not the base price (58 000)
    const item = await withTenant(T.ctx, (tx) => tx.orderItem.findFirstOrThrow({ where: { orderId: order.id } }));
    expect(num(item.unitPrice)).toBe(55000);
    expect(num(order.total)).toBe(5_500_000);

    await expect(withTenant(T.ctx, (tx) => allocateOrder(tx, T.ctx, order.id))).rejects.toThrow(/Confirm the order/);
    await withTenant(T.ctx, (tx) => confirmOrder(tx, T.ctx, order.id));
    const r = await withTenant(T.ctx, (tx) => allocateOrder(tx, T.ctx, order.id));
    expect(r.shortageKg).toBe(0);
    const allocs = await withTenant(T.ctx, (tx) => tx.orderAllocation.findMany({ where: { orderItem: { orderId: order.id } }, orderBy: { createdAt: "asc" } }));
    // mid (earliest valid) fully, remainder from late
    expect(allocs.map((a) => [a.inventoryId, a.quantityKg])).toEqual([[mid.id, 60], [late.id, 40]]);
    const midLot = await withTenant(T.ctx, (tx) => tx.inventory.findUniqueOrThrow({ where: { id: mid.id } }));
    expect(midLot.reservedKg).toBe(60);
  });
});

describe("order lifecycle", () => {
  it("New → Confirmed → Allocated → Picking → Ready → In delivery → Delivered with OTIF and invoice", async () => {
    await lot(300, 70);
    const order = await withTenant(T.ctx, (tx) =>
      createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: localDateKey(new Date(), "Asia/Tashkent"), source: "MANUAL", items: [{ productId: T.products.fillet, quantityKg: 50 }] }),
    );
    await withTenant(T.ctx, (tx) => confirmOrder(tx, T.ctx, order.id));
    await withTenant(T.ctx, (tx) => allocateOrder(tx, T.ctx, order.id));
    await withTenant(T.ctx, (tx) => startPicking(tx, T.ctx, order.id));
    const alloc = await withTenant(T.ctx, (tx) => tx.orderAllocation.findMany({ where: { orderItem: { orderId: order.id }, status: "RESERVED" } }));
    const picked = Object.fromEntries(alloc.map((a) => [a.id, a.quantityKg * 0.99])); // variable weight: 49.5 kg picked
    await withTenant(T.ctx, (tx) => completePicking(tx, T.ctx, order.id, picked));
    const stockBefore = await withTenant(T.ctx, (tx) => tx.inventory.aggregate({ where: { productId: T.products.fillet }, _sum: { quantityKg: true } }));
    await withTenant(T.ctx, (tx) => dispatchOrder(tx, T.ctx, order.id));
    const stockAfter = await withTenant(T.ctx, (tx) => tx.inventory.aggregate({ where: { productId: T.products.fillet }, _sum: { quantityKg: true } }));
    expect((stockBefore._sum.quantityKg ?? 0) - (stockAfter._sum.quantityKg ?? 0)).toBeCloseTo(49.5, 3);
    const movements = await withTenant(T.ctx, (tx) => tx.inventoryMovement.findMany({ where: { referenceId: order.id, type: "SHIPMENT" } }));
    expect(movements.reduce((s, m) => s + m.quantityKg, 0)).toBeCloseTo(-49.5, 3);

    const r = await withTenant(T.ctx, (tx) => confirmDelivery(tx, T.ctx, order.id, { receivedBy: "Chef" }));
    expect(r.status).toBe("DELIVERED"); // 49.5/50 = 99% ≥ 98% in-full tolerance
    expect(r.onTime).toBe(true);
    expect(r.amount).toBe(49.5 * 55000);
    const inv = await withTenant(T.ctx, (tx) => tx.salesInvoice.findUniqueOrThrow({ where: { orderId: order.id } }));
    expect(num(inv.amount)).toBe(2_722_500);
    const history = await withTenant(T.ctx, (tx) => tx.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }));
    expect(history.map((h) => h.toStatus)).toEqual(["NEW", "CONFIRMED", "ALLOCATED", "PICKING", "READY_FOR_DISPATCH", "IN_DELIVERY", "DELIVERED"]);
  });

  it("short delivery becomes Partially Delivered (not in full)", async () => {
    await lot(100, 70);
    const order = await withTenant(T.ctx, (tx) =>
      createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: localDateKey(new Date(), "Asia/Tashkent"), source: "MANUAL", items: [{ productId: T.products.fillet, quantityKg: 20 }] }),
    );
    await withTenant(T.ctx, async (tx) => {
      await confirmOrder(tx, T.ctx, order.id);
      await allocateOrder(tx, T.ctx, order.id);
      await startPicking(tx, T.ctx, order.id);
      await completePicking(tx, T.ctx, order.id);
      await dispatchOrder(tx, T.ctx, order.id);
    });
    const item = await withTenant(T.ctx, (tx) => tx.orderItem.findFirstOrThrow({ where: { orderId: order.id } }));
    const r = await withTenant(T.ctx, (tx) => confirmDelivery(tx, T.ctx, order.id, { delivered: { [item.id]: 15 }, receivedBy: "Dock" }));
    expect(r.status).toBe("PARTIALLY_DELIVERED");
    expect(r.inFull).toBe(false);
    await expect(withTenant(T.ctx, (tx) => confirmDelivery(tx, T.ctx, order.id))).rejects.toThrow(/not in delivery/);
  });

  it("cancelling releases reservations", async () => {
    const order = await withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: tomorrow(), source: "MANUAL", items: [{ productId: T.products.fillet, quantityKg: 30 }] }));
    await withTenant(T.ctx, async (tx) => {
      await confirmOrder(tx, T.ctx, order.id);
      await allocateOrder(tx, T.ctx, order.id);
    });
    const reservedBefore = await withTenant(T.ctx, (tx) => tx.inventory.aggregate({ where: { productId: T.products.fillet }, _sum: { reservedKg: true } }));
    await withTenant(T.ctx, (tx) => cancelOrder(tx, T.ctx, order.id, "Customer changed plans"));
    const reservedAfter = await withTenant(T.ctx, (tx) => tx.inventory.aggregate({ where: { productId: T.products.fillet }, _sum: { reservedKg: true } }));
    expect((reservedBefore._sum.reservedKg ?? 0) - (reservedAfter._sum.reservedKg ?? 0)).toBeCloseTo(30, 3);
    const o = await withTenant(T.ctx, (tx) => tx.order.findUniqueOrThrow({ where: { id: order.id } }));
    expect(o.status).toBe("CANCELLED");
  });

  it("portal orders are restricted to the assigned catalog and to future dates", async () => {
    await expect(
      withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: tomorrow(), source: "PORTAL", restrictToPriceList: true, items: [{ productId: T.products.liver, quantityKg: 5 }] })),
    ).rejects.toThrow(/not in your assigned catalog/);
    await expect(
      withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: localDateKey(new Date(), "Asia/Tashkent"), source: "PORTAL", restrictToPriceList: true, items: [{ productId: T.products.fillet, quantityKg: 5 }] })),
    ).rejects.toThrow(/at least one day/);
    await expect(
      withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: "2020-01-01", source: "MANUAL", items: [{ productId: T.products.fillet, quantityKg: 5 }] })),
    ).rejects.toThrow(/past/);
  });
});
