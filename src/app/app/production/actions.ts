"use server";

import { z } from "zod";
import { defineAction, zDate, zId, zNum, zOptNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/core";
import { addShiftInput, addShiftOutput, closeShift, createShift, deleteShiftOutput, reopenShift } from "@/server/services/production";
import { savePlan } from "@/server/services/forecast";
import { assertWithinLimit } from "@/server/services/billing";

export const createShiftAction = defineAction(
  {
    permission: "production.operate",
    schema: z.object({
      lineId: zId,
      shiftDate: zDate,
      shiftType: z.enum(["DAY", "EVENING", "NIGHT"]),
      supervisorName: zOptStr(120),
      plannedInputKg: zOptNum({ min: 0, max: 1_000_000 }),
      plannedBirds: zOptNum({ min: 0, max: 1_000_000, int: true }),
      notes: zOptStr(1000),
    }),
  },
  async (ctx, input) => {
    const shift = await withTenant(ctx, (tx) => createShift(tx, ctx, { ...input, plannedInputKg: input.plannedInputKg ?? null, plannedBirds: input.plannedBirds ?? null }));
    return { ok: true, message: "Shift {n} opened", params: { n: shift.number }, redirectTo: `/app/production/shifts/${shift.id}` };
  },
);

export const addInputAction = defineAction(
  { permission: "production.operate", schema: z.object({ shiftId: zId, batchId: zId, birdsProcessed: zNum({ min: 1, int: true }), inputWeightKg: zNum({ min: 0.1 }) }) },
  async (ctx, input) => {
    await withTenant(ctx, (tx) => addShiftInput(tx, ctx, input));
    return { ok: true, message: "Input batch registered" };
  },
);

export const addOutputAction = defineAction(
  {
    permission: "production.operate",
    schema: z.object({
      shiftId: zId,
      batchId: zId,
      outputType: z.enum(["PRODUCT", "BYPRODUCT", "WASTE"]),
      productId: z.string().optional(),
      wasteCategory: z.string().optional(),
      weightKg: zNum({ min: 0.001, max: 100000 }),
      units: zOptNum({ min: 0, int: true }),
      packages: zOptNum({ min: 0, int: true }),
      warehouseId: z.string().optional(),
      chamberId: z.string().optional(),
    }),
  },
  async (ctx, input) => {
    await withTenant(ctx, (tx) =>
      addShiftOutput(tx, ctx, {
        ...input,
        productId: input.productId || null,
        wasteCategory: input.wasteCategory || null,
        warehouseId: input.warehouseId || null,
        chamberId: input.chamberId || null,
        units: input.units ?? null,
        packages: input.packages ?? null,
      }),
    );
    return { ok: true, message: "Output recorded" };
  },
);

export const deleteOutputAction = defineAction({ permission: "production.manage", schema: z.object({ id: zId, reason: zStr(300) }) }, async (ctx, input) => {
  await withTenant(ctx, (tx) => deleteShiftOutput(tx, ctx, input.id, input.reason));
  return { ok: true, message: "Output removed" };
});

export const closeShiftAction = defineAction({ permission: "production.operate", schema: z.object({ id: zId }) }, async (ctx, input) => {
  const m = await withTenant(ctx, (tx) => closeShift(tx, ctx, input.id));
  return {
    ok: true,
    message: m.massBalanceFlag ? "Shift closed. Mass balance difference {pct}% exceeds tolerance — an alert was raised." : "Shift closed. Yield {y}%.",
    params: { pct: m.unexplainedPct.toFixed(2), y: m.totalYieldPct.toFixed(2) },
  };
});

export const reopenShiftAction = defineAction({ permission: "production.manage", schema: z.object({ id: zId, reason: zStr(300) }) }, async (ctx, input) => {
  await withTenant(ctx, (tx) => reopenShift(tx, ctx, input.id, input.reason));
  return { ok: true, message: "Shift re-opened" };
});

export const createLineAction = defineAction(
  { permission: "production.manage", schema: z.object({ facilityId: zId, code: zStr(20), name: zStr(120), capacityKgPerHour: zOptNum({ min: 0 }) }) },
  async (ctx, input) => {
    await withTenant(ctx, async (tx) => {
      if (await tx.productionLine.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: input.code.toUpperCase() } } })) throw new AppError("Line code already exists", {}, "code");
      const l = await tx.productionLine.create({ data: { tenantId: ctx.tenantId, ...input, code: input.code.toUpperCase(), capacityKgPerHour: input.capacityKgPerHour ?? null } });
      await audit(tx, ctx, { action: "line.create", entityType: "production_line", entityId: l.id, summary: l.name });
    });
    return { ok: true, message: "Production line created" };
  },
);

export const createFacilityAction = defineAction(
  { permission: "settings.manage", schema: z.object({ code: zStr(20), name: zStr(120), address: zOptStr(300) }) },
  async (ctx, input) => {
    await withTenant(ctx, async (tx) => {
      await assertWithinLimit(tx, ctx.tenantId, "facilities");
      if (await tx.facility.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: input.code.toUpperCase() } } })) throw new AppError("Facility code already exists", {}, "code");
      const f = await tx.facility.create({ data: { tenantId: ctx.tenantId, code: input.code.toUpperCase(), name: input.name, address: input.address } });
      await audit(tx, ctx, { action: "facility.create", entityType: "facility", entityId: f.id, summary: f.name });
    });
    return { ok: true, message: "Facility created" };
  },
);

export const savePlanAction = defineAction({ permission: "production.manage", feature: "forecasting", schema: z.object({ date: zDate, intent: z.enum(["save", "approve"]) }) }, async (ctx, input, fd) => {
  const adjustments: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("adj_") || typeof v !== "string" || v.trim() === "") continue;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new AppError("Planned quantities must be zero or positive numbers");
    adjustments[k.slice(4)] = n;
  }
  const count = await withTenant(ctx, (tx) => savePlan(tx, ctx, input.date, adjustments, input.intent === "approve"));
  return { ok: true, message: input.intent === "approve" ? "Production plan approved ({n} products)" : "Draft plan saved ({n} products)", params: { n: count } };
});
