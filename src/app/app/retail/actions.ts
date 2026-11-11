"use server";

import { z } from "zod";
import { defineAction, zId, zNum, zOptNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/core";
import { assertWithinLimit } from "@/server/services/billing";
import { recordReturn, recordSale } from "@/server/services/retail";

const locSchema = z.object({ code: zStr(20), name: zStr(120), brand: zOptStr(80), address: zOptStr(300), region: zOptStr(80), phone: zOptStr(40), managerName: zOptStr(120), posProvider: zOptStr(30) });
export const createRetailLocationAction = defineAction({ permission: "retail.manage", schema: locSchema }, async (ctx, input) => {
  const id = await withTenant(ctx, async (tx) => {
    await assertWithinLimit(tx, ctx.tenantId, "retail");
    const code = input.code.toUpperCase();
    if (await tx.retailLocation.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } })) throw new AppError("Store code already exists", {}, "code");
    const wh = await tx.warehouse.create({ data: { tenantId: ctx.tenantId, code: `WH-${code}`, name: `${input.name} — store stock`, type: "RETAIL", address: input.address } });
    await tx.storageChamber.createMany({
      data: [
        { tenantId: ctx.tenantId, warehouseId: wh.id, code: `${code}-C`, name: "Chilled display", type: "CHILLED", minTempC: ctx.settings.chilledMinTempC, maxTempC: ctx.settings.chilledMaxTempC },
        { tenantId: ctx.tenantId, warehouseId: wh.id, code: `${code}-F`, name: "Freezer cabinet", type: "FROZEN", maxTempC: ctx.settings.frozenMaxTempC },
      ],
    });
    const loc = await tx.retailLocation.create({ data: { tenantId: ctx.tenantId, ...input, code, warehouseId: wh.id } });
    await audit(tx, ctx, { action: "retail.create", entityType: "retail_location", entityId: loc.id, summary: loc.name });
    return loc.id;
  });
  return { ok: true, message: "Store created", redirectTo: `/app/retail/${id}` };
});

const saleSchema = z.object({ retailLocationId: zId, productId: zId, quantityKg: zNum({ min: 0.001, max: 5000 }), unitPrice: zOptNum({ min: 0 }), cashierName: zOptStr(80), receiptNo: zOptStr(40) });
export const recordSaleAction = defineAction({ permission: "retail.operate", schema: saleSchema }, async (ctx, input) => {
  const sales = await withTenant(ctx, (tx) => recordSale(tx, ctx, { ...input, unitPrice: input.unitPrice ?? null }));
  return { ok: true, message: "Sale recorded ({n} batch line(s), FEFO)", params: { n: sales.length } };
});

const retSchema = z.object({ retailLocationId: zId, productId: zId, batchId: zId, quantityKg: zNum({ min: 0.001 }), reason: zStr(300) });
export const recordRetailReturnAction = defineAction({ permission: "retail.operate", schema: retSchema }, async (ctx, input) => {
  const r = await withTenant(ctx, (tx) => recordReturn(tx, ctx, { ...input, source: "RETAIL", action: "WRITE_OFF" }));
  return { ok: true, message: "Return {n} recorded", params: { n: r.number } };
});
