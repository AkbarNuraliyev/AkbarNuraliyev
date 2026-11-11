import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db";
import { localDateKey } from "@/lib/tz";
import { addShiftOutput } from "@/server/services/production";
import { allocateOrder, completePicking, confirmDelivery, confirmOrder, createOrder, dispatchOrder, recordInvoicePayment, startPicking } from "@/server/services/orders";
import { dashboardKpis, expiryRisk, parseRange, productionByDay } from "@/server/services/analytics";
import { forecastForDate } from "@/server/services/forecast";
import { ean13CheckDigit, isValidEan13, variableWeightBarcode } from "@/server/services/labels";
import { batchInShift, makeTenant, produce, type TestTenant } from "./helpers";

let T: TestTenant;
let invoiceId: string;

beforeAll(async () => {
  T = await makeTenant("Dashboard Co");
  const { batch, shift } = await batchInShift(T); // 1000 birds, 2500 kg live
  await produce(T, shift.id, batch.id, "fillet", 1500);
  await produce(T, shift.id, batch.id, "liver", 100);
  await withTenant(T.ctx, (tx) => addShiftOutput(tx, T.ctx, { shiftId: shift.id, batchId: batch.id, outputType: "WASTE", wasteCategory: "Feathers", weightKg: 500 }));
  const today = localDateKey(new Date(), "Asia/Tashkent");
  const o = await withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: today, source: "MANUAL", items: [{ productId: T.products.fillet, quantityKg: 100 }] }));
  await withTenant(T.ctx, async (tx) => {
    await confirmOrder(tx, T.ctx, o.id);
    await allocateOrder(tx, T.ctx, o.id);
    await startPicking(tx, T.ctx, o.id);
    await completePicking(tx, T.ctx, o.id);
    await dispatchOrder(tx, T.ctx, o.id);
    await confirmDelivery(tx, T.ctx, o.id, { receivedBy: "X" });
  });
  invoiceId = (await withTenant(T.ctx, (tx) => tx.salesInvoice.findFirstOrThrow({ where: { orderId: o.id } }))).id;
  await withTenant(T.ctx, (tx) => recordInvoicePayment(tx, T.ctx, { invoiceId, amount: 1_500_000, paidAt: new Date(), method: "BANK_TRANSFER" }));
  // an open order
  await withTenant(T.ctx, (tx) => createOrder(tx, T.ctx, { customerId: T.customerId, requestedDeliveryDate: today, source: "MANUAL", items: [{ productId: T.products.wings, quantityKg: 10 }] }));
});

describe("dashboard KPIs are computed from records", () => {
  it("production, yield, waste, orders, OTIF and receivables", async () => {
    const range = parseRange({ range: "today" }, "Asia/Tashkent", new Date());
    const k = await withTenant(T.ctx, (tx) => dashboardKpis(tx, range, new Date(), T.ctx.settings));
    expect(k.inputKg).toBe(2500);
    expect(k.birds).toBe(1000);
    expect(k.productionKg).toBe(1600); // 1500 product + 100 by-product
    expect(k.yieldPct).toBeCloseTo(64, 6); // 1600 / 2500
    expect(k.wastePct).toBeCloseTo(20, 6); // 500 / 2500
    expect(k.activeOrders).toBe(1);
    expect(k.deliveredOrders).toBe(1);
    expect(k.otifPct).toBe(100);
    expect(k.salesB2b).toBe(5_500_000); // 100 kg × 55 000 contract price
    expect(k.receivables).toBe(4_000_000); // 5.5M − 1.5M paid
    expect(k.chilledKg).toBeCloseTo(1500, 3); // 1500 + 100 − 100 shipped
    expect(k.expiringKg).toBeCloseTo(1500, 3); // chilled 72 h / 48 h shelf life → all within 72 h
  });

  it("daily production series and expiry buckets", async () => {
    const range = parseRange({ range: "7d" }, "Asia/Tashkent", new Date());
    const days = await withTenant(T.ctx, (tx) => productionByDay(tx, range));
    expect(days).toHaveLength(7);
    const today = days[days.length - 1];
    expect(today.products).toBe(1500);
    expect(today.byproducts).toBe(100);
    expect(today.waste).toBe(500);
    expect(today.yieldPct).toBeCloseTo(64, 2);
    const risk = await withTenant(T.ctx, (tx) => expiryRisk(tx, new Date()));
    expect(risk.find((b) => b.key === "48")!.kg).toBeCloseTo(100, 3); // liver, 48 h shelf life
    expect(risk.find((b) => b.key === "72")!.kg).toBeCloseTo(1400, 3);
  });
});

describe("demand forecast", () => {
  it("never forecasts B2B demand below booked orders and explains its assumptions", async () => {
    const today = localDateKey(new Date(), "Asia/Tashkent");
    const fc = await withTenant(T.ctx, (tx) => forecastForDate(tx, T.ctx, today));
    const wings = fc.lines.find((l) => l.sku === "CH-WNG")!;
    expect(wings.bookedOrdersKg).toBe(10);
    expect(wings.forecastKg).toBeGreaterThanOrEqual(10);
    expect(wings.recommendedKg).toBeCloseTo(Math.max(0, wings.forecastKg + wings.safetyKg - wings.usableStockKg), 1);
    expect(wings.assumptions.join(" ")).toMatch(/Day-of-week index/);
    expect(fc.method).toMatch(/No machine-learning model/);
  });
});

describe("variable-weight barcodes", () => {
  it("builds valid EAN-13 codes with PLU and grams", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1); // known EAN 4006381333931
    const code = variableWeightBarcode("10003", 1.245);
    expect(code).toMatch(/^221000301245\d$/);
    expect(isValidEan13(code)).toBe(true);
    expect(isValidEan13("2210003012450")).toBe(code === "2210003012450");
    expect(() => variableWeightBarcode("10003", 120)).toThrow();
  });
});
