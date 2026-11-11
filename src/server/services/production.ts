import type { Tx } from "@/lib/prisma";
import type { OutputType } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { round, pct } from "@/lib/format";
import { addHours, dateOnly } from "@/lib/tz";
import { audit, nextNumber, notify, nowOf, traceEvent, type ServiceCtx } from "../core";
import { addStock, EPS, validateLocation } from "./inventory";

export const WASTE_CATEGORIES = ["Feathers", "Blood", "Inedible offal", "Heads", "Condemned carcasses", "Other waste"];

export interface ShiftMetricsInput {
  inputs: { batchId: string; inputWeightKg: number; birdsProcessed: number }[];
  outputs: { batchId: string; outputType: OutputType; productId: string | null; weightKg: number }[];
  plannedInputKg?: number | null;
  plannedBirds?: number | null;
  tolerancePct: number;
}

/**
 * Yield formulas (all relative to live input weight):
 *   Total Yield % = saleable output (products + by-products) / input × 100
 *   Product Yield % = product weight / input × 100
 *   Waste %        = waste / input × 100
 * Unexplained difference = input − saleable − waste (moisture loss, unrecorded output).
 */
export function computeShiftMetrics(m: ShiftMetricsInput) {
  const inputKg = round(m.inputs.reduce((s, i) => s + i.inputWeightKg, 0), 3);
  const birds = m.inputs.reduce((s, i) => s + i.birdsProcessed, 0);
  const sum = (t: OutputType) => round(m.outputs.filter((o) => o.outputType === t).reduce((s, o) => s + o.weightKg, 0), 3);
  const productKg = sum("PRODUCT");
  const byproductKg = sum("BYPRODUCT");
  const wasteKg = sum("WASTE");
  const saleableKg = round(productKg + byproductKg, 3);
  const unexplainedKg = round(inputKg - saleableKg - wasteKg, 3);
  const unexplainedPct = pct(unexplainedKg, inputKg);
  const byProduct = new Map<string, number>();
  for (const o of m.outputs) if (o.productId) byProduct.set(o.productId, (byProduct.get(o.productId) ?? 0) + o.weightKg);
  const byBatch = new Map<string, { inputKg: number; outputKg: number; saleableKg: number; wasteKg: number; birds: number }>();
  for (const i of m.inputs) {
    const b = byBatch.get(i.batchId) ?? { inputKg: 0, outputKg: 0, saleableKg: 0, wasteKg: 0, birds: 0 };
    b.inputKg += i.inputWeightKg;
    b.birds += i.birdsProcessed;
    byBatch.set(i.batchId, b);
  }
  for (const o of m.outputs) {
    const b = byBatch.get(o.batchId) ?? { inputKg: 0, outputKg: 0, saleableKg: 0, wasteKg: 0, birds: 0 };
    b.outputKg += o.weightKg;
    if (o.outputType === "WASTE") b.wasteKg += o.weightKg;
    else b.saleableKg += o.weightKg;
    byBatch.set(o.batchId, b);
  }
  return {
    inputKg,
    birds,
    avgBirdKg: birds ? inputKg / birds : 0,
    productKg,
    byproductKg,
    wasteKg,
    saleableKg,
    totalYieldPct: pct(saleableKg, inputKg),
    wastePct: pct(wasteKg, inputKg),
    unexplainedKg,
    unexplainedPct,
    massBalanceFlag: inputKg > 0 && (saleableKg + wasteKg > 0) && Math.abs(unexplainedPct) > m.tolerancePct,
    productYields: [...byProduct.entries()].map(([productId, kg]) => ({ productId, kg: round(kg, 3), yieldPct: pct(kg, inputKg) })),
    byBatch: [...byBatch.entries()].map(([batchId, v]) => ({
      batchId,
      ...v,
      yieldPct: pct(v.saleableKg, v.inputKg),
      wastePct: pct(v.wasteKg, v.inputKg),
      unexplainedKg: round(v.inputKg - v.outputKg, 3),
    })),
    planInputVariancePct: m.plannedInputKg ? pct(inputKg - m.plannedInputKg, m.plannedInputKg) : null,
    planBirdsVariancePct: m.plannedBirds ? pct(birds - m.plannedBirds, m.plannedBirds) : null,
  };
}

export async function createShift(
  tx: Tx,
  ctx: ServiceCtx,
  input: { lineId: string; shiftDate: string; shiftType: string; supervisorName?: string | null; plannedInputKg?: number | null; plannedBirds?: number | null; notes?: string | null },
) {
  const line = await tx.productionLine.findUnique({ where: { id: input.lineId } });
  assert(line && line.isActive, "Production line not found", {}, "lineId");
  const existing = await tx.productionShift.findFirst({
    where: { lineId: line.id, shiftDate: dateOnly(input.shiftDate), shiftType: input.shiftType, status: { not: "CLOSED" } },
  });
  if (existing) throw new AppError("An open {type} shift already exists for this line and date ({number})", { type: input.shiftType, number: existing.number });
  const number = await nextNumber(tx, ctx, "SH");
  const shift = await tx.productionShift.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      facilityId: line.facilityId,
      lineId: line.id,
      shiftDate: dateOnly(input.shiftDate),
      shiftType: input.shiftType,
      supervisorName: input.supervisorName ?? null,
      plannedInputKg: input.plannedInputKg ?? null,
      plannedBirds: input.plannedBirds ?? null,
      notes: input.notes ?? null,
      status: "OPEN",
      startedAt: nowOf(ctx),
      createdById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  await audit(tx, ctx, { action: "shift.open", entityType: "production_shift", entityId: shift.id, summary: `${number} on ${line.name}` });
  return shift;
}

async function openShift(tx: Tx, shiftId: string) {
  const shift = await tx.productionShift.findUnique({ where: { id: shiftId }, include: { line: true } });
  assert(shift, "Shift not found");
  if (shift.status !== "OPEN") throw new AppError("The shift is closed. Re-open it to record data.");
  return shift;
}

export async function addShiftInput(tx: Tx, ctx: ServiceCtx, input: { shiftId: string; batchId: string; birdsProcessed: number; inputWeightKg: number }) {
  const shift = await openShift(tx, input.shiftId);
  const batch = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
  assert(batch, "Batch not found", {}, "batchId");
  if (!["RECEIVED", "IN_PRODUCTION"].includes(batch.status))
    throw new AppError("Batch {code} cannot be processed (status: {status})", { code: batch.code, status: batch.status }, "batchId");
  assert(input.birdsProcessed > 0, "Birds processed must be greater than zero", {}, "birdsProcessed");
  assert(input.inputWeightKg > 0, "Input weight must be greater than zero", {}, "inputWeightKg");
  const birdsLeft = batch.birds - batch.processedBirds;
  const kgLeft = round(batch.liveWeightKg - batch.processedKg, 3);
  if (input.birdsProcessed > birdsLeft)
    throw new AppError("Only {n} birds remain in batch {code}", { n: birdsLeft, code: batch.code }, "birdsProcessed");
  if (input.inputWeightKg > kgLeft * 1.005 + EPS)
    throw new AppError("Input weight exceeds the remaining live weight of the batch ({kg} kg)", { kg: kgLeft }, "inputWeightKg");
  const avg = input.inputWeightKg / input.birdsProcessed;
  if (avg < 0.6 || avg > 5) throw new AppError("Average weight per bird is implausible ({avg} kg)", { avg: round(avg, 3) }, "inputWeightKg");

  const si = await tx.shiftInput.create({
    data: { tenantId: ctx.tenantId, shiftId: shift.id, batchId: batch.id, birdsProcessed: input.birdsProcessed, inputWeightKg: input.inputWeightKg, createdById: ctx.userId ?? null, createdAt: nowOf(ctx) },
  });
  const processedBirds = batch.processedBirds + input.birdsProcessed;
  await tx.productionBatch.update({
    where: { id: batch.id },
    data: {
      processedBirds,
      processedKg: round(batch.processedKg + input.inputWeightKg, 3),
      status: processedBirds >= batch.birds ? "COMPLETED" : "IN_PRODUCTION",
    },
  });
  await traceEvent(tx, ctx, {
    batchId: batch.id,
    eventType: "PRODUCTION_INPUT",
    description: `Processed in shift ${shift.number} (${shift.line.name}): ${input.birdsProcessed} birds, ${input.inputWeightKg} kg`,
    quantityKg: input.inputWeightKg,
    location: shift.line.name,
    entityType: "production_shift",
    entityId: shift.id,
  });
  await audit(tx, ctx, { action: "shift.input", entityType: "production_shift", entityId: shift.id, summary: `${batch.code}: ${input.birdsProcessed} birds / ${input.inputWeightKg} kg` });
  return si;
}

export interface OutputInput {
  shiftId: string;
  batchId: string;
  outputType: OutputType;
  productId?: string | null;
  wasteCategory?: string | null;
  weightKg: number;
  units?: number | null;
  packages?: number | null;
  warehouseId?: string | null;
  chamberId?: string | null;
}

export async function addShiftOutput(tx: Tx, ctx: ServiceCtx, input: OutputInput) {
  const shift = await openShift(tx, input.shiftId);
  assert(input.weightKg > 0, "Weight must be greater than zero", {}, "weightKg");
  const inputs = await tx.shiftInput.findMany({ where: { shiftId: shift.id, batchId: input.batchId } });
  if (!inputs.length) throw new AppError("Register this batch as a shift input before recording its output", {}, "batchId");
  const batch = await tx.productionBatch.findUniqueOrThrow({ where: { id: input.batchId } });
  if (batch.status === "BLOCKED" || batch.status === "RECALLED") throw new AppError("Batch {code} is blocked", { code: batch.code });

  const inputKg = inputs.reduce((s, i) => s + i.inputWeightKg, 0);
  const agg = await tx.productionOutput.aggregate({ where: { shiftId: shift.id, batchId: batch.id }, _sum: { weightKg: true } });
  const already = agg._sum.weightKg ?? 0;
  if (already + input.weightKg > inputKg + EPS) {
    throw new AppError(
      "Impossible mass balance: outputs ({out} kg) would exceed the input weight of batch {code} in this shift ({in} kg)",
      { out: round(already + input.weightKg, 2), in: round(inputKg, 2), code: batch.code },
      "weightKg",
    );
  }

  const producedAt = nowOf(ctx);
  let productName = input.wasteCategory ?? "Waste";
  let inventoryId: string | null = null;

  if (input.outputType !== "WASTE") {
    assert(input.productId, "Select a product", {}, "productId");
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    assert(product && product.isActive, "Product not found", {}, "productId");
    productName = product.name;
    assert(input.warehouseId, "Select the warehouse where the output is stored", {}, "warehouseId");
    const { warehouse, chamber } = await validateLocation(tx, input.warehouseId, input.chamberId, product.storageType);
    if (!product.isVariableWeight && product.netWeightKg && input.units) {
      const expected = product.netWeightKg * input.units;
      if (Math.abs(expected - input.weightKg) / expected > 0.05)
        throw new AppError("Weight does not match {units} units × {net} kg fixed net weight", { units: input.units, net: product.netWeightKg }, "weightKg");
    }
    const output = await tx.productionOutput.create({
      data: {
        tenantId: ctx.tenantId,
        shiftId: shift.id,
        batchId: batch.id,
        outputType: input.outputType,
        productId: product.id,
        weightKg: round(input.weightKg, 3),
        units: input.units ?? null,
        warehouseId: warehouse.id,
        chamberId: chamber?.id ?? null,
        producedAt,
        createdById: ctx.userId ?? null,
        createdAt: producedAt,
      },
    });
    const lot = await addStock(tx, ctx, {
      productId: product.id,
      batchId: batch.id,
      warehouseId: warehouse.id,
      chamberId: chamber?.id ?? null,
      productionDate: producedAt,
      expiryDate: addHours(producedAt, product.shelfLifeHours),
      quantityKg: input.weightKg,
      units: input.units ?? null,
      unitCost: product.costPerKg ? Number(product.costPerKg) : null,
      type: "PRODUCTION_IN",
      referenceType: "PRODUCTION_OUTPUT",
      referenceId: output.id,
      reason: `Shift ${shift.number}`,
      mergeWindowHours: 12,
    });
    inventoryId = lot.id;
    await tx.packagingRecord.create({
      data: {
        tenantId: ctx.tenantId,
        outputId: output.id,
        productId: product.id,
        batchId: batch.id,
        inventoryId: lot.id,
        packages: input.packages ?? input.units ?? 1,
        netWeightKg: round(input.weightKg, 3),
        packagingType: product.isVariableWeight ? "Variable-weight pack" : "Fixed-weight pack",
        packedAt: producedAt,
        packedById: ctx.userId ?? null,
      },
    });
    await traceEvent(tx, ctx, {
      batchId: batch.id,
      eventType: "PACKAGED",
      description: `${product.name}: ${round(input.weightKg, 2)} kg packed in shift ${shift.number} → ${warehouse.name}${chamber ? " / " + chamber.name : ""}`,
      quantityKg: input.weightKg,
      location: warehouse.name,
      entityType: "inventory",
      entityId: lot.id,
      at: producedAt,
    });
    await audit(tx, ctx, { action: "shift.output", entityType: "production_shift", entityId: shift.id, summary: `${batch.code}: ${product.name} ${input.weightKg} kg` });
    return { output, inventoryId };
  }

  const category = input.wasteCategory && WASTE_CATEGORIES.includes(input.wasteCategory) ? input.wasteCategory : null;
  assert(category, "Select a waste category", {}, "wasteCategory");
  const output = await tx.productionOutput.create({
    data: {
      tenantId: ctx.tenantId,
      shiftId: shift.id,
      batchId: batch.id,
      outputType: "WASTE",
      wasteCategory: category,
      weightKg: round(input.weightKg, 3),
      producedAt,
      createdById: ctx.userId ?? null,
      createdAt: producedAt,
    },
  });
  await audit(tx, ctx, { action: "shift.output", entityType: "production_shift", entityId: shift.id, summary: `${batch.code}: waste ${productName} ${input.weightKg} kg` });
  return { output, inventoryId };
}

/** Deletes an erroneous output (only while the shift is open and stock is untouched). */
export async function deleteShiftOutput(tx: Tx, ctx: ServiceCtx, outputId: string, reason: string) {
  const output = await tx.productionOutput.findUnique({ where: { id: outputId }, include: { packaging: true, shift: true } });
  assert(output, "Output not found");
  if (output.shift.status !== "OPEN") throw new AppError("The shift is closed. Re-open it to correct data.");
  if (output.packaging?.inventoryId) {
    const lot = await tx.inventory.findUnique({ where: { id: output.packaging.inventoryId } });
    if (!lot || lot.reservedKg > EPS || lot.quantityKg + EPS < output.weightKg)
      throw new AppError("This output has already been allocated, moved or sold and cannot be deleted. Use an inventory adjustment instead.");
    await tx.inventory.update({ where: { id: lot.id }, data: { quantityKg: round(lot.quantityKg - output.weightKg, 3) } });
    await tx.inventoryMovement.create({
      data: {
        tenantId: ctx.tenantId,
        type: "ADJUSTMENT",
        inventoryId: lot.id,
        productId: lot.productId,
        batchId: lot.batchId,
        warehouseId: lot.warehouseId,
        chamberId: lot.chamberId,
        quantityKg: -output.weightKg,
        reason: `Production output correction: ${reason}`,
        referenceType: "PRODUCTION_OUTPUT",
        referenceId: output.id,
        userId: ctx.userId ?? null,
        createdAt: nowOf(ctx),
      },
    });
  }
  await tx.productionOutput.delete({ where: { id: output.id } });
  await audit(tx, ctx, {
    action: "shift.output_delete",
    entityType: "production_shift",
    entityId: output.shiftId,
    summary: `${output.outputType} ${output.weightKg} kg removed: ${reason}`,
  });
}

export async function closeShift(tx: Tx, ctx: ServiceCtx, shiftId: string) {
  const shift = await openShift(tx, shiftId);
  const [inputs, outputs] = await Promise.all([
    tx.shiftInput.findMany({ where: { shiftId } }),
    tx.productionOutput.findMany({ where: { shiftId } }),
  ]);
  if (!inputs.length) throw new AppError("Cannot close a shift without inputs");
  const m = computeShiftMetrics({ inputs, outputs, plannedInputKg: shift.plannedInputKg, plannedBirds: shift.plannedBirds, tolerancePct: ctx.settings.massBalanceTolerancePct });
  await tx.productionShift.update({ where: { id: shiftId }, data: { status: "CLOSED", closedAt: nowOf(ctx) } });
  if (m.massBalanceFlag) {
    await notify(tx, ctx, {
      type: "MASS_BALANCE",
      severity: "WARNING",
      title: `Unexplained mass difference in shift ${shift.number}`,
      message: `${round(m.unexplainedKg, 1)} kg (${round(m.unexplainedPct, 2)}%) of input weight is not accounted for by outputs or waste (tolerance ${ctx.settings.massBalanceTolerancePct}%).`,
      link: `/app/production/shifts/${shiftId}`,
      entityType: "production_shift",
      entityId: shiftId,
      dedupeKey: `mass:${shiftId}`,
    });
  }
  await audit(tx, ctx, {
    action: "shift.close",
    entityType: "production_shift",
    entityId: shiftId,
    summary: `${shift.number}: input ${round(m.inputKg, 1)} kg, yield ${round(m.totalYieldPct, 2)}%, waste ${round(m.wastePct, 2)}%`,
  });
  return m;
}

export async function reopenShift(tx: Tx, ctx: ServiceCtx, shiftId: string, reason: string) {
  const shift = await tx.productionShift.findUnique({ where: { id: shiftId } });
  assert(shift, "Shift not found");
  if (shift.status === "OPEN") return shift;
  await tx.productionShift.update({ where: { id: shiftId }, data: { status: "OPEN", closedAt: null } });
  await audit(tx, ctx, { action: "shift.reopen", entityType: "production_shift", entityId: shiftId, summary: reason });
  return shift;
}
