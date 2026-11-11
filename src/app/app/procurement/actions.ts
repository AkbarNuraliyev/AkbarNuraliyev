"use server";

import { z } from "zod";
import { defineAction, zBool, zId, zOptNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit, diff } from "@/server/core";

const supplierSchema = z.object({
  code: zStr(20).transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9-]+$/, "Use letters, digits and dashes only")),
  name: zStr(160),
  type: z.enum(["FARM", "INTEGRATOR", "TRADER"]),
  taxId: zOptStr(20),
  contactName: zOptStr(120),
  phone: zOptStr(40),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")).transform((v) => v || null),
  address: zOptStr(300),
  region: zOptStr(80),
  contractNumber: zOptStr(60),
  contractStart: z.string().optional().transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)),
  contractEnd: z.string().optional().transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)),
  paymentTermsDays: zOptNum({ min: 0, max: 365, int: true }),
  pricePerKgLive: zOptNum({ min: 0, max: 10_000_000 }),
  notes: zOptStr(2000),
});

export const createSupplierAction = defineAction({ permission: "procurement.manage", schema: supplierSchema }, async (ctx, input) => {
  if (input.contractStart && input.contractEnd && input.contractEnd < input.contractStart) throw new AppError("Contract end must be after the start date", {}, "contractEnd");
  const id = await withTenant(ctx, async (tx) => {
    if (await tx.supplier.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: input.code } } })) throw new AppError("Supplier code already exists", {}, "code");
    const s = await tx.supplier.create({ data: { tenantId: ctx.tenantId, ...input, paymentTermsDays: input.paymentTermsDays ?? null, pricePerKgLive: input.pricePerKgLive ?? null } });
    await audit(tx, ctx, { action: "supplier.create", entityType: "supplier", entityId: s.id, summary: `${s.code} ${s.name}` });
    return s.id;
  });
  return { ok: true, message: "Supplier created", redirectTo: `/app/procurement/suppliers/${id}` };
});

export const updateSupplierAction = defineAction({ permission: "procurement.manage", schema: supplierSchema.extend({ id: zId, isActive: zBool }) }, async (ctx, input) => {
  const { id, ...data } = input;
  if (data.contractStart && data.contractEnd && data.contractEnd < data.contractStart) throw new AppError("Contract end must be after the start date", {}, "contractEnd");
  await withTenant(ctx, async (tx) => {
    const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
    const dup = await tx.supplier.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: data.code } } });
    if (dup && dup.id !== id) throw new AppError("Supplier code already exists", {}, "code");
    const after = await tx.supplier.update({ where: { id }, data: { ...data, paymentTermsDays: data.paymentTermsDays ?? null, pricePerKgLive: data.pricePerKgLive ?? null } });
    await audit(tx, ctx, { action: "supplier.update", entityType: "supplier", entityId: id, summary: after.name, changes: diff(before as never, after as never) });
  });
  return { ok: true, message: "Supplier updated" };
});

const farmSchema = z.object({
  supplierId: zId,
  code: zStr(20).transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9-]+$/, "Use letters, digits and dashes only")),
  name: zStr(160),
  region: zOptStr(80),
  district: zOptStr(80),
  address: zOptStr(300),
  capacityBirds: zOptNum({ min: 0, max: 100_000_000, int: true }),
  breed: zOptStr(60),
  vetRegistration: zOptStr(60),
  latitude: zOptNum({ min: -90, max: 90 }),
  longitude: zOptNum({ min: -180, max: 180 }),
});

export const createFarmAction = defineAction({ permission: "procurement.manage", schema: farmSchema }, async (ctx, input) => {
  const id = await withTenant(ctx, async (tx) => {
    if (await tx.farm.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: input.code } } })) throw new AppError("Farm code already exists", {}, "code");
    const sup = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!sup) throw new AppError("Supplier not found", {}, "supplierId");
    const f = await tx.farm.create({ data: { tenantId: ctx.tenantId, ...input, capacityBirds: input.capacityBirds ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null } });
    await audit(tx, ctx, { action: "farm.create", entityType: "farm", entityId: f.id, summary: `${f.code} ${f.name}` });
    return f.id;
  });
  return { ok: true, message: "Farm created", redirectTo: `/app/procurement/farms/${id}` };
});

export const updateFarmAction = defineAction({ permission: "procurement.manage", schema: farmSchema.extend({ id: zId, isActive: zBool }) }, async (ctx, input) => {
  const { id, ...data } = input;
  await withTenant(ctx, async (tx) => {
    const before = await tx.farm.findUniqueOrThrow({ where: { id } });
    const dup = await tx.farm.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: data.code } } });
    if (dup && dup.id !== id) throw new AppError("Farm code already exists", {}, "code");
    const after = await tx.farm.update({ where: { id }, data: { ...data, capacityBirds: data.capacityBirds ?? null, latitude: data.latitude ?? null, longitude: data.longitude ?? null } });
    await audit(tx, ctx, { action: "farm.update", entityType: "farm", entityId: id, summary: after.name, changes: diff(before as never, after as never) });
  });
  return { ok: true, message: "Farm updated" };
});
