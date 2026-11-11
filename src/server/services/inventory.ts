import type { Tx } from "@/lib/prisma";
import type { MovementType, InventoryStatus } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { round } from "@/lib/format";
import { addHours } from "@/lib/tz";
import { audit, nextNumber, nowOf, traceEvent, type ServiceCtx } from "../core";

export const EPS = 0.0005;

export interface AddStockInput {
  productId: string;
  batchId: string;
  warehouseId: string;
  chamberId?: string | null;
  productionDate: Date;
  expiryDate: Date;
  quantityKg: number;
  units?: number | null;
  unitCost?: number | null;
  status?: InventoryStatus;
  type: MovementType;
  reason?: string | null;
  referenceType?: string;
  referenceId?: string;
  /** Merge into an existing lot of the same product/batch/location with expiry within this many hours. */
  mergeWindowHours?: number;
}

/** Validates that a chamber can hold a product of the given storage type. */
export async function validateLocation(tx: Tx, warehouseId: string, chamberId: string | null | undefined, storageType?: string) {
  const wh = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  assert(wh && wh.isActive, "Warehouse not found");
  if (!chamberId) return { warehouse: wh, chamber: null };
  const ch = await tx.storageChamber.findUnique({ where: { id: chamberId } });
  assert(ch && ch.warehouseId === warehouseId, "The storage chamber does not belong to the selected warehouse");
  if (storageType === "FROZEN" && ch.type !== "FROZEN") throw new AppError("Frozen products must be stored in a freezer chamber");
  if (storageType === "CHILLED" && ch.type === "FROZEN") throw new AppError("Chilled products cannot be stored in a freezer chamber");
  return { warehouse: wh, chamber: ch };
}

export async function addStock(tx: Tx, ctx: ServiceCtx, input: AddStockInput) {
  assert(input.quantityKg > 0, "Quantity must be greater than zero");
  const status = input.status ?? "AVAILABLE";
  let lot = null as Awaited<ReturnType<typeof tx.inventory.findFirst>>;
  if (input.mergeWindowHours) {
    lot = await tx.inventory.findFirst({
      where: {
        productId: input.productId,
        batchId: input.batchId,
        warehouseId: input.warehouseId,
        chamberId: input.chamberId ?? null,
        status,
        expiryDate: { gte: addHours(input.expiryDate, -input.mergeWindowHours), lte: addHours(input.expiryDate, input.mergeWindowHours) },
      },
    });
  }
  if (lot) {
    lot = await tx.inventory.update({
      where: { id: lot.id },
      data: {
        quantityKg: round(lot.quantityKg + input.quantityKg, 3),
        units: lot.units !== null || input.units ? (lot.units ?? 0) + (input.units ?? 0) : null,
        // keep the earliest expiry — conservative for FEFO
        expiryDate: input.expiryDate < lot.expiryDate ? input.expiryDate : lot.expiryDate,
      },
    });
  } else {
    lot = await tx.inventory.create({
      data: {
        tenantId: ctx.tenantId,
        productId: input.productId,
        batchId: input.batchId,
        warehouseId: input.warehouseId,
        chamberId: input.chamberId ?? null,
        productionDate: input.productionDate,
        expiryDate: input.expiryDate,
        quantityKg: round(input.quantityKg, 3),
        units: input.units ?? null,
        unitCost: input.unitCost ?? null,
        status,
        createdAt: nowOf(ctx),
      },
    });
  }
  await tx.inventoryMovement.create({
    data: {
      tenantId: ctx.tenantId,
      type: input.type,
      inventoryId: lot.id,
      productId: input.productId,
      batchId: input.batchId,
      warehouseId: input.warehouseId,
      chamberId: input.chamberId ?? null,
      quantityKg: round(input.quantityKg, 3),
      reason: input.reason ?? null,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userId: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  return lot;
}

/**
 * Removes stock from a lot. When `fromReserved` is set the quantity is taken
 * out of the lot's reservation (order dispatch); otherwise only unreserved
 * quantity may be consumed.
 */
export async function removeStock(
  tx: Tx,
  ctx: ServiceCtx,
  input: {
    inventoryId: string;
    quantityKg: number;
    type: MovementType;
    reason?: string | null;
    referenceType?: string;
    referenceId?: string;
    fromReserved?: number;
    allowBlocked?: boolean;
  },
) {
  assert(input.quantityKg > 0, "Quantity must be greater than zero");
  const lot = await tx.inventory.findUnique({ where: { id: input.inventoryId } });
  assert(lot, "Inventory lot not found");
  if (!input.allowBlocked && lot.status === "BLOCKED") throw new AppError("This lot is blocked and cannot be used");
  const fromReserved = Math.min(input.fromReserved ?? 0, lot.reservedKg);
  const free = lot.quantityKg - lot.reservedKg + fromReserved;
  if (input.quantityKg > free + EPS) {
    throw new AppError("Insufficient stock: requested {req} kg, available {avail} kg", {
      req: round(input.quantityKg, 3),
      avail: round(Math.max(0, free), 3),
    });
  }
  const updated = await tx.inventory.update({
    where: { id: lot.id },
    data: {
      quantityKg: Math.max(0, round(lot.quantityKg - input.quantityKg, 3)),
      reservedKg: Math.max(0, round(lot.reservedKg - fromReserved, 3)),
    },
  });
  await tx.inventoryMovement.create({
    data: {
      tenantId: ctx.tenantId,
      type: input.type,
      inventoryId: lot.id,
      productId: lot.productId,
      batchId: lot.batchId,
      warehouseId: lot.warehouseId,
      chamberId: lot.chamberId,
      quantityKg: -round(input.quantityKg, 3),
      reason: input.reason ?? null,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userId: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  return { lot, updated };
}

const WRITE_OFF_TYPES = ["WRITE_OFF", "DAMAGE", "EXPIRED"] as const;
export type WriteOffType = (typeof WRITE_OFF_TYPES)[number];

export async function writeOff(tx: Tx, ctx: ServiceCtx, input: { inventoryId: string; quantityKg: number; type: WriteOffType; reason: string }) {
  assert(WRITE_OFF_TYPES.includes(input.type), "Invalid write-off type");
  const { lot } = await removeStock(tx, ctx, { ...input, allowBlocked: true, referenceType: "WRITE_OFF" });
  await traceEvent(tx, ctx, {
    batchId: lot.batchId,
    eventType: "WRITE_OFF",
    description: `${input.type.replace("_", " ").toLowerCase()} — ${input.reason}`,
    quantityKg: input.quantityKg,
    entityType: "inventory",
    entityId: lot.id,
  });
  await audit(tx, ctx, {
    action: "inventory.write_off",
    entityType: "inventory",
    entityId: lot.id,
    summary: `${input.type} ${input.quantityKg} kg: ${input.reason}`,
    changes: { quantityKg: { from: lot.quantityKg, to: round(lot.quantityKg - input.quantityKg, 3) } },
  });
}

export async function adjustStock(tx: Tx, ctx: ServiceCtx, input: { inventoryId: string; newQuantityKg: number; reason: string; type?: MovementType }) {
  const lot = await tx.inventory.findUnique({ where: { id: input.inventoryId } });
  assert(lot, "Inventory lot not found");
  assert(input.newQuantityKg >= 0, "Quantity cannot be negative");
  if (input.newQuantityKg + EPS < lot.reservedKg)
    throw new AppError("Quantity cannot be lower than the reserved quantity ({reserved} kg). Release order allocations first.", { reserved: round(lot.reservedKg, 3) });
  const delta = round(input.newQuantityKg - lot.quantityKg, 3);
  if (Math.abs(delta) < EPS) return lot;
  const updated = await tx.inventory.update({ where: { id: lot.id }, data: { quantityKg: round(input.newQuantityKg, 3) } });
  await tx.inventoryMovement.create({
    data: {
      tenantId: ctx.tenantId,
      type: input.type ?? "ADJUSTMENT",
      inventoryId: lot.id,
      productId: lot.productId,
      batchId: lot.batchId,
      warehouseId: lot.warehouseId,
      chamberId: lot.chamberId,
      quantityKg: delta,
      reason: input.reason,
      referenceType: "ADJUSTMENT",
      userId: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  await audit(tx, ctx, {
    action: "inventory.adjust",
    entityType: "inventory",
    entityId: lot.id,
    summary: input.reason,
    changes: { quantityKg: { from: lot.quantityKg, to: input.newQuantityKg } },
  });
  return updated;
}

export async function setLotStatus(tx: Tx, ctx: ServiceCtx, input: { inventoryId: string; status: InventoryStatus; reason: string }) {
  const lot = await tx.inventory.findUnique({ where: { id: input.inventoryId } });
  assert(lot, "Inventory lot not found");
  if (lot.status === input.status) return lot;
  const updated = await tx.inventory.update({
    where: { id: lot.id },
    data: { status: input.status, blockedReason: input.status === "AVAILABLE" ? null : input.reason },
  });
  await tx.inventoryMovement.create({
    data: {
      tenantId: ctx.tenantId,
      type: input.status === "AVAILABLE" ? "UNBLOCK" : "BLOCK",
      inventoryId: lot.id,
      productId: lot.productId,
      batchId: lot.batchId,
      warehouseId: lot.warehouseId,
      chamberId: lot.chamberId,
      quantityKg: 0,
      reason: input.reason,
      userId: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  await audit(tx, ctx, {
    action: input.status === "AVAILABLE" ? "inventory.unblock" : "inventory.block",
    entityType: "inventory",
    entityId: lot.id,
    summary: input.reason,
    changes: { status: { from: lot.status, to: input.status } },
  });
  return updated;
}

/** Moves stock between warehouses / chambers. Creates a transfer document. */
export async function transferStock(
  tx: Tx,
  ctx: ServiceCtx,
  input: { toWarehouseId: string; toChamberId?: string | null; lines: { inventoryId: string; quantityKg: number }[]; notes?: string | null },
) {
  assert(input.lines.length > 0, "Add at least one line to transfer");
  const first = await tx.inventory.findUnique({ where: { id: input.lines[0].inventoryId } });
  assert(first, "Inventory lot not found");
  const fromWarehouseId = first.warehouseId;
  const dest = await tx.warehouse.findUnique({ where: { id: input.toWarehouseId } });
  assert(dest && dest.isActive, "Destination warehouse not found");
  const number = await nextNumber(tx, ctx, "TRF");
  const transfer = await tx.stockTransfer.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      notes: input.notes ?? null,
      createdById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  for (const line of input.lines) {
    const lot = await tx.inventory.findUnique({ where: { id: line.inventoryId }, include: { product: true, warehouse: true } });
    assert(lot, "Inventory lot not found");
    assert(lot.warehouseId === fromWarehouseId, "All transferred lots must come from the same warehouse");
    if (lot.status !== "AVAILABLE") throw new AppError("Lot {batch} is not available for transfer", { batch: lot.batchId });
    if (lot.expiryDate < nowOf(ctx)) throw new AppError("Expired stock cannot be transferred. Write it off instead.");
    if (lot.warehouseId === input.toWarehouseId && (lot.chamberId ?? null) === (input.toChamberId ?? null))
      throw new AppError("Source and destination are the same");
    await validateLocation(tx, input.toWarehouseId, input.toChamberId, lot.product.storageType);
    await removeStock(tx, ctx, {
      inventoryId: lot.id,
      quantityKg: line.quantityKg,
      type: "TRANSFER_OUT",
      referenceType: "TRANSFER",
      referenceId: transfer.id,
      reason: `${number} → ${dest.name}`,
    });
    await addStock(tx, ctx, {
      productId: lot.productId,
      batchId: lot.batchId,
      warehouseId: input.toWarehouseId,
      chamberId: input.toChamberId ?? null,
      productionDate: lot.productionDate,
      expiryDate: lot.expiryDate,
      quantityKg: line.quantityKg,
      unitCost: lot.unitCost ? Number(lot.unitCost) : null,
      type: "TRANSFER_IN",
      referenceType: "TRANSFER",
      referenceId: transfer.id,
      reason: `${number} ← ${lot.warehouse.name}`,
      mergeWindowHours: 1,
    });
    await tx.stockTransferLine.create({
      data: { tenantId: ctx.tenantId, transferId: transfer.id, inventoryId: lot.id, productId: lot.productId, batchId: lot.batchId, quantityKg: line.quantityKg },
    });
    await traceEvent(tx, ctx, {
      batchId: lot.batchId,
      eventType: "TRANSFER",
      description: `${lot.product.name}: ${lot.warehouse.name} → ${dest.name} (${number})`,
      quantityKg: line.quantityKg,
      location: dest.name,
      entityType: "transfer",
      entityId: transfer.id,
    });
  }
  await audit(tx, ctx, { action: "inventory.transfer", entityType: "stock_transfer", entityId: transfer.id, summary: number });
  return transfer;
}

export interface FefoCandidate {
  id: string;
  batchId: string;
  expiryDate: Date;
  free: number;
}

/**
 * FEFO: picks the earliest-expiring available lots first.
 * Lots that expire before `mustBeValidUntil` are excluded.
 */
export async function fefoCandidates(
  tx: Tx,
  input: { productId: string; mustBeValidUntil: Date; warehouseIds?: string[]; excludeRetail?: boolean },
): Promise<FefoCandidate[]> {
  const lots = await tx.inventory.findMany({
    where: {
      productId: input.productId,
      status: "AVAILABLE",
      quantityKg: { gt: EPS },
      expiryDate: { gt: input.mustBeValidUntil },
      ...(input.warehouseIds ? { warehouseId: { in: input.warehouseIds } } : {}),
      ...(input.excludeRetail ? { warehouse: { type: { not: "RETAIL" } } } : {}),
    },
    orderBy: [{ expiryDate: "asc" }, { productionDate: "asc" }, { createdAt: "asc" }],
  });
  return lots
    .map((l) => ({ id: l.id, batchId: l.batchId, expiryDate: l.expiryDate, free: round(l.quantityKg - l.reservedKg, 3) }))
    .filter((l) => l.free > EPS);
}

export function planFefo(candidates: FefoCandidate[], requiredKg: number) {
  const picks: { inventoryId: string; batchId: string; quantityKg: number; expiryDate: Date }[] = [];
  let remaining = round(requiredKg, 3);
  for (const c of candidates) {
    if (remaining <= EPS) break;
    const take = round(Math.min(c.free, remaining), 3);
    if (take <= EPS) continue;
    picks.push({ inventoryId: c.id, batchId: c.batchId, quantityKg: take, expiryDate: c.expiryDate });
    remaining = round(remaining - take, 3);
  }
  return { picks, shortageKg: Math.max(0, remaining) };
}

/** Stocktake: snapshot of a warehouse, counted values, then posting of variances. */
export async function createStocktake(tx: Tx, ctx: ServiceCtx, input: { warehouseId: string; notes?: string | null }) {
  const wh = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
  assert(wh, "Warehouse not found");
  const open = await tx.stocktake.findFirst({ where: { warehouseId: wh.id, status: "OPEN" } });
  if (open) throw new AppError("A stocktake is already open for this warehouse ({number})", { number: open.number });
  const lots = await tx.inventory.findMany({ where: { warehouseId: wh.id, quantityKg: { gt: EPS } } });
  const number = await nextNumber(tx, ctx, "STK");
  const st = await tx.stocktake.create({
    data: { tenantId: ctx.tenantId, number, warehouseId: wh.id, notes: input.notes ?? null, createdById: ctx.userId ?? null, createdAt: nowOf(ctx) },
  });
  if (lots.length) {
    await tx.stocktakeLine.createMany({
      data: lots.map((l) => ({ tenantId: ctx.tenantId, stocktakeId: st.id, inventoryId: l.id, systemKg: l.quantityKg })),
    });
  }
  await audit(tx, ctx, { action: "stocktake.create", entityType: "stocktake", entityId: st.id, summary: `${number} — ${wh.name}` });
  return st;
}

export async function saveStocktakeCounts(tx: Tx, ctx: ServiceCtx, stocktakeId: string, counts: Record<string, number | null>) {
  const st = await tx.stocktake.findUnique({ where: { id: stocktakeId } });
  assert(st && st.status === "OPEN", "Stocktake is not open");
  for (const [lineId, counted] of Object.entries(counts)) {
    if (counted !== null && (counted < 0 || !Number.isFinite(counted))) throw new AppError("Counted quantity cannot be negative");
    await tx.stocktakeLine.updateMany({ where: { id: lineId, stocktakeId }, data: { countedKg: counted } });
  }
}

export async function completeStocktake(tx: Tx, ctx: ServiceCtx, stocktakeId: string) {
  const st = await tx.stocktake.findUnique({ where: { id: stocktakeId }, include: { lines: true } });
  assert(st && st.status === "OPEN", "Stocktake is not open");
  const uncounted = st.lines.filter((l) => l.countedKg === null).length;
  if (uncounted) throw new AppError("{n} line(s) have not been counted yet", { n: uncounted });
  let adjusted = 0;
  for (const line of st.lines) {
    const lot = await tx.inventory.findUnique({ where: { id: line.inventoryId } });
    if (!lot) continue;
    // Variance relative to the snapshot, applied to the current quantity (movements since snapshot are preserved).
    const variance = round((line.countedKg ?? 0) - line.systemKg, 3);
    if (Math.abs(variance) < EPS) continue;
    const target = Math.max(lot.reservedKg, round(lot.quantityKg + variance, 3));
    await adjustStock(tx, ctx, { inventoryId: lot.id, newQuantityKg: target, reason: `Stocktake ${st.number}`, type: "STOCKTAKE" });
    adjusted++;
  }
  await tx.stocktake.update({ where: { id: st.id }, data: { status: "COMPLETED", completedAt: nowOf(ctx), completedById: ctx.userId ?? null } });
  await audit(tx, ctx, { action: "stocktake.complete", entityType: "stocktake", entityId: st.id, summary: `${st.number}: ${adjusted} adjustment(s)` });
  return adjusted;
}
