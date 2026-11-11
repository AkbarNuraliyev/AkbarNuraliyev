import type { Tx } from "@/lib/prisma";
import { AppError, assert } from "@/lib/errors";
import { round } from "@/lib/format";
import { audit, nextNumber, notify, nowOf, traceEvent, type ServiceCtx } from "../core";
import { EPS } from "./inventory";
import { emitWebhook } from "./webhooks";

/** Full one-up/one-down trace of a production batch. */
export async function traceBatch(tx: Tx, batchId: string) {
  const batch = await tx.productionBatch.findUnique({
    where: { id: batchId },
    include: {
      supplier: true,
      farm: true,
      receipt: { include: { facility: true } },
      shiftInputs: { include: { shift: { include: { line: true, facility: true } } }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { occurredAt: "asc" } },
      recalls: { include: { actions: { orderBy: { createdAt: "asc" } } }, orderBy: { initiatedAt: "desc" } },
      nonconformities: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!batch) return null;

  const [outputs, inventory, allocations, sales, labels, returns, qc] = await Promise.all([
    tx.productionOutput.findMany({ where: { batchId }, include: { product: true, shift: true }, orderBy: { producedAt: "asc" } }),
    tx.inventory.findMany({
      where: { batchId, quantityKg: { gt: EPS } },
      include: { product: true, warehouse: { include: { retail: true } }, chamber: true },
      orderBy: { expiryDate: "asc" },
    }),
    tx.orderAllocation.findMany({
      where: { batchId, status: { in: ["RESERVED", "PICKED", "SHIPPED"] } },
      include: { orderItem: { include: { product: true, order: { include: { customer: true, stops: { include: { shipment: { include: { vehicle: true, driver: true } } } } } } } } },
    }),
    tx.sale.groupBy({ by: ["retailLocationId", "productId"], where: { batchId }, _sum: { quantityKg: true, total: true } }),
    tx.label.findMany({ where: { batchId }, include: { product: true }, orderBy: { printedAt: "desc" }, take: 50 }),
    tx.returnRecord.findMany({ where: { batchId }, include: { customer: true }, orderBy: { createdAt: "desc" } }),
    tx.qualityRecord.findMany({
      where: { OR: [{ batchId }, { entityType: "raw_material_receipt", entityId: batch.receiptId }] },
      include: { checklist: true },
      orderBy: { performedAt: "desc" },
    }),
  ]);

  const productIds = [...new Set(sales.map((s) => s.productId))];
  const locIds = [...new Set(sales.map((s) => s.retailLocationId))];
  const [saleProducts, saleLocs] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
    tx.retailLocation.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true, code: true } }),
  ]);

  const byProduct = new Map<string, { productId: string; name: string; sku: string; kg: number; type: string }>();
  let wasteKg = 0;
  for (const o of outputs) {
    if (o.outputType === "WASTE") {
      wasteKg += o.weightKg;
      continue;
    }
    const key = o.productId!;
    const e = byProduct.get(key) ?? { productId: key, name: o.product!.name, sku: o.product!.sku, kg: 0, type: o.outputType };
    e.kg += o.weightKg;
    byProduct.set(key, e);
  }

  const customers = new Map<string, { customerId: string; name: string; code: string; type: string; phone: string | null; kg: number; orders: Set<string>; status: string }>();
  const shipments = new Map<string, { id: string; number: string; vehicle: string; driver: string; status: string; departedAt: Date | null; orders: Set<string> }>();
  for (const a of allocations) {
    const order = a.orderItem.order;
    const c = customers.get(order.customerId) ?? {
      customerId: order.customerId,
      name: order.customer.name,
      code: order.customer.code,
      type: order.customer.type,
      phone: order.customer.phone,
      kg: 0,
      orders: new Set<string>(),
      status: a.status,
    };
    c.kg += a.quantityKg;
    c.orders.add(order.number);
    if (a.status === "SHIPPED") c.status = "SHIPPED";
    customers.set(order.customerId, c);
    for (const st of order.stops) {
      if (st.shipment.status === "CANCELLED") continue;
      const s = shipments.get(st.shipmentId) ?? {
        id: st.shipmentId,
        number: st.shipment.number,
        vehicle: st.shipment.vehicle.plate,
        driver: st.shipment.driver.name,
        status: st.shipment.status,
        departedAt: st.shipment.departedAt,
        orders: new Set<string>(),
      };
      s.orders.add(order.number);
      shipments.set(st.shipmentId, s);
    }
  }

  const inputKg = batch.shiftInputs.reduce((s, i) => s + i.inputWeightKg, 0);
  const saleableKg = [...byProduct.values()].reduce((s, p) => s + p.kg, 0);
  return {
    batch,
    qc,
    shifts: batch.shiftInputs,
    products: [...byProduct.values()].map((p) => ({ ...p, kg: round(p.kg, 3) })),
    yield: { inputKg, saleableKg, wasteKg, yieldPct: inputKg ? (saleableKg / inputKg) * 100 : 0 },
    inventory,
    inventoryKg: round(inventory.reduce((s, l) => s + l.quantityKg, 0), 3),
    retailStock: inventory.filter((l) => l.warehouse.type === "RETAIL"),
    customers: [...customers.values()].map((c) => ({ ...c, kg: round(c.kg, 3), orders: [...c.orders] })),
    shipments: [...shipments.values()].map((s) => ({ ...s, orders: [...s.orders] })),
    retailSales: sales.map((s) => ({
      location: saleLocs.find((l) => l.id === s.retailLocationId)?.name ?? "—",
      product: saleProducts.find((p) => p.id === s.productId)?.name ?? "—",
      kg: round(s._sum.quantityKg ?? 0, 3),
      total: Number(s._sum.total ?? 0),
    })),
    labels,
    returns,
  };
}

export type TraceResult = NonNullable<Awaited<ReturnType<typeof traceBatch>>>;

/** Search batches by code, farm, supplier, product, production date or QR/label code. */
export async function searchBatches(tx: Tx, q: { text?: string; productId?: string; farmId?: string; supplierId?: string; from?: Date; to?: Date }) {
  const text = q.text?.trim();
  const or = text
    ? [
        { code: { contains: text, mode: "insensitive" as const } },
        { publicToken: text },
        { farm: { name: { contains: text, mode: "insensitive" as const } } },
        { farm: { code: { contains: text, mode: "insensitive" as const } } },
        { supplier: { name: { contains: text, mode: "insensitive" as const } } },
        { receipt: { number: { contains: text, mode: "insensitive" as const } } },
        { labels: { some: { OR: [{ serial: text }, { barcode: text }] } } },
      ]
    : undefined;
  return tx.productionBatch.findMany({
    where: {
      ...(or ? { OR: or } : {}),
      ...(q.farmId ? { farmId: q.farmId } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.productId ? { outputs: { some: { productId: q.productId } } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
    },
    include: { farm: true, supplier: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Blocks all stock of a batch (all warehouses and stores) and releases unshipped allocations. */
async function blockBatchStock(tx: Tx, ctx: ServiceCtx, batchId: string, reason: string) {
  const lots = await tx.inventory.findMany({ where: { batchId, quantityKg: { gt: EPS } } });
  let blockedKg = 0;
  for (const lot of lots) {
    blockedKg += lot.quantityKg;
    if (lot.status === "BLOCKED") continue;
    await tx.inventory.update({ where: { id: lot.id }, data: { status: "BLOCKED", blockedReason: reason } });
    await tx.inventoryMovement.create({
      data: {
        tenantId: ctx.tenantId,
        type: "BLOCK",
        inventoryId: lot.id,
        productId: lot.productId,
        batchId,
        warehouseId: lot.warehouseId,
        chamberId: lot.chamberId,
        quantityKg: 0,
        reason,
        userId: ctx.userId ?? null,
        createdAt: nowOf(ctx),
      },
    });
  }
  const allocs = await tx.orderAllocation.findMany({
    where: { batchId, status: { in: ["RESERVED", "PICKED"] } },
    include: { orderItem: { include: { order: true } } },
  });
  const touchedOrders = new Map<string, { id: string; number: string; status: string }>();
  for (const a of allocs) {
    const lot = await tx.inventory.findUnique({ where: { id: a.inventoryId } });
    if (lot) await tx.inventory.update({ where: { id: lot.id }, data: { reservedKg: Math.max(0, round(lot.reservedKg - a.quantityKg, 3)) } });
    await tx.orderAllocation.update({ where: { id: a.id }, data: { status: "RELEASED" } });
    await tx.orderItem.update({
      where: { id: a.orderItemId },
      data: {
        allocatedKg: Math.max(0, round(a.orderItem.allocatedKg - a.quantityKg, 3)),
        pickedKg: a.status === "PICKED" ? Math.max(0, round(a.orderItem.pickedKg - a.quantityKg, 3)) : a.orderItem.pickedKg,
      },
    });
    touchedOrders.set(a.orderItem.orderId, { id: a.orderItem.orderId, number: a.orderItem.order.number, status: a.orderItem.order.status });
  }
  for (const o of touchedOrders.values()) {
    if (o.status === "PICKING" || o.status === "READY_FOR_DISPATCH") {
      await tx.order.update({ where: { id: o.id }, data: { status: "ALLOCATED" } });
      await tx.orderStatusHistory.create({
        data: { tenantId: ctx.tenantId, orderId: o.id, fromStatus: o.status as never, toStatus: "ALLOCATED", note: `Allocation released: ${reason}`, userId: ctx.userId ?? null, createdAt: nowOf(ctx) },
      });
    }
  }
  return { blockedKg: round(blockedKg, 3), lots: lots.length, releasedOrders: [...touchedOrders.values()].map((o) => o.number) };
}

export async function blockBatch(tx: Tx, ctx: ServiceCtx, batchId: string, reason: string) {
  const batch = await tx.productionBatch.findUnique({ where: { id: batchId } });
  assert(batch, "Batch not found");
  assert(reason?.length >= 3, "Please provide a reason");
  const r = await blockBatchStock(tx, ctx, batchId, reason);
  await tx.productionBatch.update({ where: { id: batchId }, data: { status: batch.status === "RECALLED" ? "RECALLED" : "BLOCKED", blockedReason: reason } });
  await traceEvent(tx, ctx, { batchId, eventType: "BLOCKED", description: `Batch blocked: ${reason}. ${r.blockedKg} kg in ${r.lots} lot(s) blocked.`, quantityKg: r.blockedKg });
  await audit(tx, ctx, { action: "batch.block", entityType: "production_batch", entityId: batchId, summary: `${batch.code}: ${reason}` });
  return r;
}

export async function initiateRecall(tx: Tx, ctx: ServiceCtx, input: { batchId: string; reason: string }) {
  const batch = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
  assert(batch, "Batch not found");
  assert(input.reason?.length >= 5, "Describe the recall reason", {}, "reason");
  const open = await tx.recall.findFirst({ where: { batchId: batch.id, status: { not: "CLOSED" } } });
  if (open) throw new AppError("A recall is already open for this batch ({number})", { number: open.number });
  const number = await nextNumber(tx, ctx, "RCL");
  const r = await blockBatchStock(tx, ctx, batch.id, `Recall ${number}`);
  const recall = await tx.recall.create({
    data: { tenantId: ctx.tenantId, number, batchId: batch.id, reason: input.reason, initiatedById: ctx.userId ?? null, initiatedAt: nowOf(ctx), blockedKg: r.blockedKg, status: "IN_PROGRESS" },
  });
  await tx.recallAction.create({
    data: {
      tenantId: ctx.tenantId,
      recallId: recall.id,
      actionType: "BLOCK_INVENTORY",
      description: `Automatically blocked ${r.blockedKg} kg in ${r.lots} lot(s)${r.releasedOrders.length ? `; released allocations on orders ${r.releasedOrders.join(", ")}` : ""}.`,
      userId: ctx.userId ?? null,
      userName: ctx.userName ?? null,
      createdAt: nowOf(ctx),
    },
  });
  await tx.productionBatch.update({ where: { id: batch.id }, data: { status: "RECALLED", blockedReason: `Recall ${number}: ${input.reason}` } });
  await traceEvent(tx, ctx, { batchId: batch.id, eventType: "RECALLED", description: `Recall ${number} initiated: ${input.reason}`, quantityKg: r.blockedKg });
  await notify(tx, ctx, {
    type: "RECALL",
    severity: "CRITICAL",
    title: `Recall ${number} initiated for batch ${batch.code}`,
    message: input.reason,
    link: `/app/traceability/${batch.id}`,
    entityType: "recall",
    entityId: recall.id,
  });
  await audit(tx, ctx, { action: "recall.initiate", entityType: "recall", entityId: recall.id, summary: `${number} — ${batch.code}: ${input.reason}` });
  await emitWebhook(tx, ctx, "recall.initiated", { recall: number, batch: batch.code, reason: input.reason, blockedKg: r.blockedKg });
  return recall;
}

export async function addRecallAction(tx: Tx, ctx: ServiceCtx, input: { recallId: string; actionType: string; description: string }) {
  const recall = await tx.recall.findUnique({ where: { id: input.recallId } });
  assert(recall, "Recall not found");
  if (recall.status === "CLOSED") throw new AppError("The recall is closed");
  assert(input.description?.length >= 3, "Describe the action", {}, "description");
  await tx.recallAction.create({
    data: { tenantId: ctx.tenantId, recallId: recall.id, actionType: input.actionType, description: input.description, userId: ctx.userId ?? null, userName: ctx.userName ?? null, createdAt: nowOf(ctx) },
  });
  await traceEvent(tx, ctx, { batchId: recall.batchId, eventType: "RECALL_ACTION", description: `${recall.number}: ${input.actionType.replaceAll("_", " ").toLowerCase()} — ${input.description}` });
  await audit(tx, ctx, { action: "recall.action", entityType: "recall", entityId: recall.id, summary: `${input.actionType}: ${input.description}` });
}

export async function closeRecall(tx: Tx, ctx: ServiceCtx, input: { recallId: string; summary: string }) {
  const recall = await tx.recall.findUnique({ where: { id: input.recallId } });
  assert(recall, "Recall not found");
  if (recall.status === "CLOSED") throw new AppError("The recall is already closed");
  assert(input.summary?.length >= 5, "Provide a closing summary", {}, "summary");
  await tx.recallAction.create({
    data: { tenantId: ctx.tenantId, recallId: recall.id, actionType: "CLOSED", description: input.summary, userId: ctx.userId ?? null, userName: ctx.userName ?? null, createdAt: nowOf(ctx) },
  });
  await tx.recall.update({ where: { id: recall.id }, data: { status: "CLOSED", closedAt: nowOf(ctx) } });
  await audit(tx, ctx, { action: "recall.close", entityType: "recall", entityId: recall.id, summary: input.summary });
}
