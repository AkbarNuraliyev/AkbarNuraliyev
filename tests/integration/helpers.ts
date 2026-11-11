import { withSystem, withTenant } from "@/lib/db";
import { hashPassword, randomToken } from "@/lib/crypto";
import { DEFAULT_SETTINGS, parseSettings } from "@/lib/settings";
import type { Tx } from "@/lib/prisma";
import type { ServiceCtx } from "@/server/core";
import { createWorkspace } from "@/server/services/tenants";
import { createReceipt, type ReceiptInput } from "@/server/services/receiving";
import { addShiftInput, addShiftOutput, createShift } from "@/server/services/production";

export interface TestTenant {
  ctx: ServiceCtx;
  tenantId: string;
  ownerId: string;
  supplierId: string;
  farmId: string;
  farmCode: string;
  customerId: string;
  priceListId: string;
  warehouseId: string;
  chilledChamberId: string;
  frozenChamberId: string;
  lineId: string;
  products: Record<"fillet" | "wings" | "frozen" | "liver", string>;
  batchFormat: string;
  batchPrefix: string;
}

let counter = 0;

/** Creates an isolated tenant with minimal master data, using the real provisioning service. */
export async function makeTenant(name: string, planCode = "ENTERPRISE", now = new Date()): Promise<TestTenant> {
  counter++;
  const email = `owner-${counter}-${randomToken(4)}@test.local`;
  const passwordHash = await hashPassword("Passw0rd!");
  const { ws, ownerId } = await withSystem(async (tx) => {
    const owner = await tx.user.create({ data: { email, name: `Owner ${name}`, passwordHash } });
    const ws = await createWorkspace(tx, { name, ownerUserId: owner.id, planCode, batchPrefix: "TEST", activeSubscription: true, now });
    return { ws, ownerId: owner.id };
  });
  const tenantId = ws.tenant.id;
  const ctx: ServiceCtx = { tenantId, userId: ownerId, userName: `Owner ${name}`, tz: "Asia/Tashkent", settings: parseSettings({ ...DEFAULT_SETTINGS }) };
  const rest = await withTenant(ctx, async (tx) => {
    const supplier = await tx.supplier.create({ data: { tenantId, code: "SUP1", name: `${name} supplier`, pricePerKgLive: 21000 } });
    const farm = await tx.farm.create({ data: { tenantId, supplierId: supplier.id, code: "FARM001", name: `${name} farm` } });
    const cats = await tx.productCategory.findMany();
    const chilled = cats.find((c) => c.code === "CHILLED")!;
    const frozenCat = cats.find((c) => c.code === "FROZEN")!;
    const by = cats.find((c) => c.code === "BYPRODUCT")!;
    const mk = (sku: string, catId: string, price: number, shelf: number, storage: "CHILLED" | "FROZEN", byproduct = false) =>
      tx.product.create({ data: { tenantId, sku, name: sku, categoryId: catId, price, costPerKg: price * 0.7, shelfLifeHours: shelf, storageType: storage, isByproduct: byproduct, pluCode: String(10000 + counter) } });
    const fillet = await mk("CH-BRF", chilled.id, 58000, 72, "CHILLED");
    const wings = await mk("CH-WNG", chilled.id, 34000, 72, "CHILLED");
    const frozen = await mk("FR-BRF", frozenCat.id, 52000, 4320, "FROZEN");
    const liver = await mk("BP-LIV", by.id, 28000, 48, "CHILLED", true);
    const pl = await tx.priceList.create({ data: { tenantId, name: "Contract" } });
    await tx.priceListItem.createMany({ data: [{ tenantId, priceListId: pl.id, productId: fillet.id, price: 55000 }, { tenantId, priceListId: pl.id, productId: wings.id, price: 32000 }] });
    const customer = await tx.customer.create({ data: { tenantId, code: "C1", name: `${name} customer`, type: "HORECA", paymentTermsDays: 7, priceListId: pl.id } });
    const chambers = await tx.storageChamber.findMany();
    const line = await tx.productionLine.findFirstOrThrow();
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return {
      supplierId: supplier.id,
      farmId: farm.id,
      farmCode: farm.code,
      customerId: customer.id,
      priceListId: pl.id,
      warehouseId: ws.warehouse.id,
      chilledChamberId: chambers.find((c) => c.type === "CHILLED")!.id,
      frozenChamberId: chambers.find((c) => c.type === "FROZEN")!.id,
      lineId: line.id,
      products: { fillet: fillet.id, wings: wings.id, frozen: frozen.id, liver: liver.id },
      batchFormat: tenant.batchFormat,
      batchPrefix: tenant.batchPrefix,
    };
  });
  return { ctx, tenantId, ownerId, ...rest };
}

export function receiptInput(t: TestTenant, over: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    supplierId: t.supplierId,
    farmId: t.farmId,
    receivedAt: new Date(Date.now() - 3600000),
    birdsDeclared: 1000,
    birdsReceived: 1000,
    birdsDeadOnArrival: 0,
    birdsRejected: 0,
    grossWeightKg: 3500,
    tareWeightKg: 1000,
    appearanceOk: true,
    decision: "ACCEPTED",
    ...over,
  };
}

export const tx = <T,>(t: TestTenant, fn: (tx: Tx) => Promise<T>) => withTenant(t.ctx, fn);

/** Receives a batch, opens a shift, registers the full batch as input. */
export async function batchInShift(t: TestTenant, over: Partial<ReceiptInput> = {}) {
  const { batch, receipt } = await tx(t, (x) => createReceipt(x, t.ctx, receiptInput(t, over), { batchFormat: t.batchFormat, batchPrefix: t.batchPrefix }));
  const shift = await tx(t, async (x) => {
    const existing = await x.productionShift.findFirst({ where: { status: "OPEN" } });
    return existing ?? createShift(x, t.ctx, { lineId: t.lineId, shiftDate: new Date().toISOString().slice(0, 10), shiftType: "DAY" });
  });
  await tx(t, (x) => addShiftInput(x, t.ctx, { shiftId: shift.id, batchId: batch.id, birdsProcessed: batch.birds, inputWeightKg: batch.liveWeightKg }));
  return { batch, receipt, shift };
}

export async function produce(t: TestTenant, shiftId: string, batchId: string, productKey: keyof TestTenant["products"], kg: number, at?: Date) {
  const ctx = at ? { ...t.ctx, now: at } : t.ctx;
  const product = t.products[productKey];
  const frozen = productKey === "frozen";
  return withTenant(t.ctx, (x) =>
    addShiftOutput(x, ctx, { shiftId, batchId, outputType: productKey === "liver" ? "BYPRODUCT" : "PRODUCT", productId: product, weightKg: kg, warehouseId: t.warehouseId, chamberId: frozen ? t.frozenChamberId : t.chilledChamberId }),
  );
}
