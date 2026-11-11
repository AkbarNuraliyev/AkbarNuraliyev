"use server";

import { z } from "zod";
import { defineAction, zId, zJson, zNum, zOptNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/core";
import { adjustStock, completeStocktake, createStocktake, EPS, saveStocktakeCounts, setLotStatus, transferStock, writeOff } from "@/server/services/inventory";
import { assertWithinLimit } from "@/server/services/billing";

const adjustSchema = z.object({ inventoryId: zId, newQuantityKg: zNum({ min: 0 }), reason: zStr(300) });
export const adjustLotAction = defineAction({ permission: "inventory.manage", schema: adjustSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => adjustStock(tx, ctx, input));
  return { ok: true, message: "Inventory adjusted" };
});

const writeOffSchema = z.object({ inventoryId: zId, quantityKg: zNum({ min: 0.001 }), type: z.enum(["WRITE_OFF", "DAMAGE", "EXPIRED"]), reason: zStr(300) });
export const writeOffLotAction = defineAction({ permission: "inventory.manage", schema: writeOffSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => writeOff(tx, ctx, input));
  return { ok: true, message: "Stock written off" };
});

const moveSchema = z.object({ inventoryId: zId, quantityKg: zNum({ min: 0.001 }), toWarehouseId: zId, toChamberId: zOptStr(40), notes: zOptStr(300) });
export const moveLotAction = defineAction({ permission: "inventory.operate", schema: moveSchema }, async (ctx, input) => {
  const tr = await withTenant(ctx, (tx) => transferStock(tx, ctx, { toWarehouseId: input.toWarehouseId, toChamberId: input.toChamberId, notes: input.notes, lines: [{ inventoryId: input.inventoryId, quantityKg: input.quantityKg }] }));
  return { ok: true, message: "Transfer {n} completed", params: { n: tr.number } };
});

const transferSchema = z.object({
  toWarehouseId: zId,
  toChamberId: zOptStr(40),
  notes: zOptStr(300),
  lines: zJson(z.array(z.object({ inventoryId: z.string(), quantityKg: z.number().positive() })).min(1, "Add at least one line to transfer")),
});
export const createTransferAction = defineAction({ permission: "inventory.operate", schema: transferSchema }, async (ctx, input) => {
  const tr = await withTenant(ctx, (tx) => transferStock(tx, ctx, input));
  return { ok: true, message: "Transfer {n} completed", params: { n: tr.number }, redirectTo: "/app/inventory/transfers" };
});

const statusSchema = z.object({ inventoryId: zId, status: z.enum(["AVAILABLE", "BLOCKED", "QUARANTINE"]), reason: zStr(300) });
export const setLotStatusAction = defineAction({ permission: "inventory.manage", schema: statusSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const lot = await tx.inventory.findUniqueOrThrow({ where: { id: input.inventoryId }, include: { batch: true } });
    if (input.status === "AVAILABLE" && lot.batch.status === "RECALLED") throw new AppError("Stock of a recalled batch cannot be released");
    if (input.status !== "AVAILABLE" && lot.reservedKg > EPS) throw new AppError("This lot has reservations for orders. Re-allocate the orders first or block the whole batch from Traceability.");
    await setLotStatus(tx, ctx, input);
  });
  return { ok: true, message: input.status === "AVAILABLE" ? "Lot released" : "Lot status updated" };
});

export const writeOffExpiredAction = defineAction({ permission: "inventory.manage" }, async (ctx) => {
  const n = await withTenant(ctx, async (tx) => {
    const lots = await tx.inventory.findMany({ where: { quantityKg: { gt: EPS }, expiryDate: { lte: new Date() } } });
    let count = 0;
    for (const l of lots) {
      if (l.reservedKg > EPS) continue;
      await writeOff(tx, ctx, { inventoryId: l.id, quantityKg: l.quantityKg, type: "EXPIRED", reason: "Expired — bulk write-off" });
      count++;
    }
    return count;
  });
  return { ok: true, message: "{n} expired lot(s) written off", params: { n } };
});

const stocktakeSchema = z.object({ warehouseId: zId, notes: zOptStr(300) });
export const createStocktakeAction = defineAction({ permission: "inventory.operate", schema: stocktakeSchema }, async (ctx, input) => {
  const st = await withTenant(ctx, (tx) => createStocktake(tx, ctx, input));
  return { ok: true, message: "Stocktake {n} started", params: { n: st.number }, redirectTo: `/app/inventory/stocktakes/${st.id}` };
});

const countsSchema = z.object({ id: zId, intent: z.enum(["save", "complete"]).default("save") });
export const saveCountsAction = defineAction({ permission: "inventory.operate", schema: countsSchema }, async (ctx, input, fd) => {
  const counts: Record<string, number | null> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("c_") || typeof v !== "string") continue;
    counts[k.slice(2)] = v.trim() === "" ? null : Number(v.replace(",", "."));
  }
  if (input.intent === "complete" && !ctx.can("inventory.manage")) throw new AppError("Completing a stocktake requires the inventory manage permission");
  const adjusted = await withTenant(ctx, async (tx) => {
    await saveStocktakeCounts(tx, ctx, input.id, counts);
    return input.intent === "complete" ? completeStocktake(tx, ctx, input.id) : null;
  });
  return adjusted === null ? { ok: true, message: "Counts saved" } : { ok: true, message: "Stocktake completed — {n} adjustment(s) posted", params: { n: adjusted } };
});

const whSchema = z.object({ code: zStr(20), name: zStr(120), type: z.enum(["FACTORY", "DISTRIBUTION"]), address: zOptStr(300), facilityId: zOptStr(40) });
export const createWarehouseAction = defineAction({ permission: "inventory.manage", schema: whSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const existing = await tx.warehouse.count({ where: { type: { not: "RETAIL" } } });
    if (existing >= 1 && !ctx.has("multi_warehouse")) throw new AppError("Multiple warehouses are not included in your plan");
    await assertWithinLimit(tx, ctx.tenantId, "warehouses");
    if (await tx.warehouse.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: input.code.toUpperCase() } } })) throw new AppError("Warehouse code already exists", {}, "code");
    const w = await tx.warehouse.create({ data: { tenantId: ctx.tenantId, ...input, code: input.code.toUpperCase(), facilityId: input.facilityId || null } });
    await audit(tx, ctx, { action: "warehouse.create", entityType: "warehouse", entityId: w.id, summary: w.name });
  });
  return { ok: true, message: "Warehouse created" };
});

const chamberSchema = z.object({ warehouseId: zId, code: zStr(20), name: zStr(120), type: z.enum(["CHILLED", "FROZEN", "AMBIENT", "QUARANTINE"]), minTempC: zOptNum({ min: -40, max: 30 }), maxTempC: zOptNum({ min: -40, max: 30 }), capacityKg: zOptNum({ min: 0 }) });
export const createChamberAction = defineAction({ permission: "inventory.manage", schema: chamberSchema }, async (ctx, input) => {
  if (input.minTempC !== undefined && input.maxTempC !== undefined && input.minTempC > input.maxTempC) throw new AppError("Minimum temperature must be below maximum", {}, "minTempC");
  await withTenant(ctx, async (tx) => {
    if (await tx.storageChamber.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: input.code.toUpperCase() } } })) throw new AppError("Chamber code already exists", {}, "code");
    const c = await tx.storageChamber.create({ data: { tenantId: ctx.tenantId, ...input, code: input.code.toUpperCase(), minTempC: input.minTempC ?? null, maxTempC: input.maxTempC ?? null, capacityKg: input.capacityKg ?? null } });
    await audit(tx, ctx, { action: "chamber.create", entityType: "storage_chamber", entityId: c.id, summary: c.name });
  });
  return { ok: true, message: "Storage chamber created" };
});
