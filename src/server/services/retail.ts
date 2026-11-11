import type { Tx } from "@/lib/prisma";
import { AppError, assert } from "@/lib/errors";
import { num, round } from "@/lib/format";
import { audit, nextNumber, nowOf, traceEvent, type ServiceCtx } from "../core";
import { addStock, EPS, fefoCandidates, planFefo, removeStock } from "./inventory";

/** Records a retail sale; stock is consumed from the store's own inventory using FEFO. */
export async function recordSale(
  tx: Tx,
  ctx: ServiceCtx,
  input: { retailLocationId: string; productId: string; quantityKg: number; unitPrice?: number | null; cashierName?: string | null; receiptNo?: string | null; soldAt?: Date; source?: string },
) {
  const loc = await tx.retailLocation.findUnique({ where: { id: input.retailLocationId } });
  assert(loc && loc.isActive, "Retail location not found", {}, "retailLocationId");
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  assert(product, "Product not found", {}, "productId");
  assert(input.quantityKg > 0, "Quantity must be greater than zero", {}, "quantityKg");
  const at = input.soldAt ?? nowOf(ctx);
  const candidates = await fefoCandidates(tx, { productId: product.id, mustBeValidUntil: at, warehouseIds: [loc.warehouseId] });
  const { picks, shortageKg } = planFefo(candidates, input.quantityKg);
  if (shortageKg > EPS)
    throw new AppError("Insufficient stock of {product} in this store ({avail} kg available, not expired)", {
      product: product.name,
      avail: round(input.quantityKg - shortageKg, 3),
    }, "quantityKg");
  const unitPrice = input.unitPrice ?? num(product.price);
  const sales = [];
  for (const p of picks) {
    const sale = await tx.sale.create({
      data: {
        tenantId: ctx.tenantId,
        retailLocationId: loc.id,
        type: "SALE",
        receiptNo: input.receiptNo ?? null,
        productId: product.id,
        batchId: p.batchId,
        inventoryId: p.inventoryId,
        quantityKg: p.quantityKg,
        unitPrice,
        total: round(unitPrice * p.quantityKg, 2),
        cashierName: input.cashierName ?? null,
        source: input.source ?? "MANUAL",
        soldAt: at,
        createdById: ctx.userId ?? null,
        createdAt: nowOf(ctx),
      },
    });
    await removeStock(tx, ctx, { inventoryId: p.inventoryId, quantityKg: p.quantityKg, type: "SALE", referenceType: "SALE", referenceId: sale.id, reason: `${loc.name}` });
    await traceEvent(tx, ctx, {
      batchId: p.batchId,
      eventType: "SOLD",
      description: `${product.name}: ${p.quantityKg} kg sold at ${loc.name}`,
      quantityKg: p.quantityKg,
      location: loc.name,
      entityType: "sale",
      entityId: sale.id,
      at,
    });
    sales.push(sale);
  }
  return sales;
}

export async function recordReturn(
  tx: Tx,
  ctx: ServiceCtx,
  input: {
    source: "B2B" | "RETAIL";
    customerId?: string | null;
    orderId?: string | null;
    retailLocationId?: string | null;
    productId: string;
    batchId: string;
    quantityKg: number;
    reason: string;
    action: "RESTOCK" | "WRITE_OFF";
    restockWarehouseId?: string | null;
    restockChamberId?: string | null;
  },
) {
  assert(input.quantityKg > 0, "Quantity must be greater than zero", {}, "quantityKg");
  assert(input.reason?.length >= 3, "Please describe the return reason", {}, "reason");
  const batch = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
  assert(batch, "Batch not found", {}, "batchId");
  const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
  let refLabel = "";
  if (input.source === "B2B") {
    assert(input.customerId, "Select the customer", {}, "customerId");
    if (input.orderId) {
      const delivered = await tx.orderAllocation.aggregate({
        where: { batchId: batch.id, status: "SHIPPED", orderItem: { orderId: input.orderId, productId: product.id } },
        _sum: { quantityKg: true },
      });
      const max = delivered._sum.quantityKg ?? 0;
      if (input.quantityKg > max + EPS)
        throw new AppError("Returned quantity exceeds the quantity of this batch delivered with the order ({kg} kg)", { kg: round(max, 3) }, "quantityKg");
      const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
      refLabel = ` (order ${order.number})`;
    }
  } else {
    assert(input.retailLocationId, "Select the retail location", {}, "retailLocationId");
  }
  const number = await nextNumber(tx, ctx, "RET");
  const rec = await tx.returnRecord.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      source: input.source,
      customerId: input.customerId ?? null,
      orderId: input.orderId ?? null,
      retailLocationId: input.retailLocationId ?? null,
      productId: product.id,
      batchId: batch.id,
      quantityKg: input.quantityKg,
      reason: input.reason,
      action: input.action,
      createdById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  if (input.source === "RETAIL" && input.retailLocationId) {
    const loc = await tx.retailLocation.findUniqueOrThrow({ where: { id: input.retailLocationId } });
    const price = num(product.price);
    await tx.sale.create({
      data: {
        tenantId: ctx.tenantId,
        retailLocationId: loc.id,
        type: "RETURN",
        productId: product.id,
        batchId: batch.id,
        quantityKg: -input.quantityKg,
        unitPrice: price,
        total: -round(price * input.quantityKg, 2),
        soldAt: nowOf(ctx),
        createdById: ctx.userId ?? null,
        createdAt: nowOf(ctx),
      },
    });
    refLabel = ` (${loc.name})`;
  }
  if (input.action === "RESTOCK") {
    const target = input.restockWarehouseId;
    assert(target, "Select where the returned goods are placed", {}, "restockWarehouseId");
    const lot = await tx.inventory.findFirst({ where: { batchId: batch.id, productId: product.id }, orderBy: { expiryDate: "desc" } });
    assert(lot, "Original lot information not found for this batch");
    if (lot.expiryDate < nowOf(ctx)) throw new AppError("Expired goods cannot be restocked — choose write-off");
    await addStock(tx, ctx, {
      productId: product.id,
      batchId: batch.id,
      warehouseId: target,
      chamberId: input.restockChamberId ?? null,
      productionDate: lot.productionDate,
      expiryDate: lot.expiryDate,
      quantityKg: input.quantityKg,
      status: "QUARANTINE",
      type: "RETURN",
      referenceType: "RETURN",
      referenceId: rec.id,
      reason: `Return ${number} — quarantine pending QC`,
    });
  }
  await traceEvent(tx, ctx, {
    batchId: batch.id,
    eventType: "RETURNED",
    description: `${product.name}: ${input.quantityKg} kg returned${refLabel} — ${input.reason} → ${input.action === "RESTOCK" ? "quarantine" : "write-off"}`,
    quantityKg: input.quantityKg,
    entityType: "return",
    entityId: rec.id,
  });
  await audit(tx, ctx, { action: "return.create", entityType: "return", entityId: rec.id, summary: `${number}: ${product.name} ${input.quantityKg} kg, ${input.action}` });
  return rec;
}
