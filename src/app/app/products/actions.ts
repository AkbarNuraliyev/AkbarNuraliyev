"use server";

import { z } from "zod";
import { defineAction, zBool, zId, zNum, zOptNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit, diff } from "@/server/core";
import { createLabels, isValidEan13 } from "@/server/services/labels";

const productSchema = z.object({
  sku: zStr(30),
  name: zStr(160),
  categoryId: zId,
  description: zOptStr(2000),
  ingredients: zOptStr(2000),
  isVariableWeight: zBool,
  netWeightKg: zOptNum({ min: 0.001, max: 1000 }),
  storageType: z.enum(["CHILLED", "FROZEN", "AMBIENT"]),
  storageTempMin: zOptNum({ min: -40, max: 30 }),
  storageTempMax: zOptNum({ min: -40, max: 30 }),
  storageInstructions: zOptStr(300),
  shelfLifeHours: zNum({ min: 1, max: 24 * 730, int: true }),
  price: zNum({ min: 0, max: 100_000_000 }),
  costPerKg: zOptNum({ min: 0, max: 100_000_000 }),
  barcode: zOptStr(14),
  pluCode: zOptStr(5),
  batchTracking: zBool,
  isByproduct: zBool,
  targetYieldPct: zOptNum({ min: 0, max: 100 }),
  minStockKg: zOptNum({ min: 0, max: 10_000_000 }),
});

function validate(input: z.infer<typeof productSchema>) {
  if (!input.isVariableWeight && !input.netWeightKg) throw new AppError("Fixed-weight products need a net weight", {}, "netWeightKg");
  if (input.barcode && !isValidEan13(input.barcode)) throw new AppError("Barcode must be a valid EAN-13 (13 digits with check digit)", {}, "barcode");
  if (input.pluCode && !/^\d{1,5}$/.test(input.pluCode)) throw new AppError("PLU code must be up to 5 digits", {}, "pluCode");
  if (input.storageTempMin !== undefined && input.storageTempMax !== undefined && input.storageTempMin > input.storageTempMax)
    throw new AppError("Minimum temperature must be below maximum", {}, "storageTempMin");
}

function data(input: z.infer<typeof productSchema>) {
  return {
    ...input,
    sku: input.sku.toUpperCase(),
    netWeightKg: input.netWeightKg ?? null,
    storageTempMin: input.storageTempMin ?? null,
    storageTempMax: input.storageTempMax ?? null,
    costPerKg: input.costPerKg ?? null,
    targetYieldPct: input.targetYieldPct ?? null,
    minStockKg: input.minStockKg ?? null,
  };
}

export const createProductAction = defineAction({ permission: "products.manage", schema: productSchema }, async (ctx, input) => {
  validate(input);
  const id = await withTenant(ctx, async (tx) => {
    if (await tx.product.findUnique({ where: { tenantId_sku: { tenantId: ctx.tenantId, sku: input.sku.toUpperCase() } } })) throw new AppError("SKU already exists", {}, "sku");
    const p = await tx.product.create({ data: { tenantId: ctx.tenantId, ...data(input) } });
    await audit(tx, ctx, { action: "product.create", entityType: "product", entityId: p.id, summary: `${p.sku} ${p.name}` });
    return p.id;
  });
  return { ok: true, message: "Product created", redirectTo: `/app/products/${id}` };
});

const updateSchema = productSchema.extend({ id: zId, isActive: zBool });

export const updateProductAction = defineAction({ permission: "products.manage", schema: updateSchema }, async (ctx, input) => {
  validate(input);
  const { id, isActive, ...rest } = input;
  await withTenant(ctx, async (tx) => {
    const before = await tx.product.findUniqueOrThrow({ where: { id } });
    const dup = await tx.product.findUnique({ where: { tenantId_sku: { tenantId: ctx.tenantId, sku: rest.sku.toUpperCase() } } });
    if (dup && dup.id !== id) throw new AppError("SKU already exists", {}, "sku");
    const after = await tx.product.update({ where: { id }, data: { ...data(rest), isActive } });
    await audit(tx, ctx, { action: "product.update", entityType: "product", entityId: id, summary: after.name, changes: diff(before as never, after as never) });
  });
  return { ok: true, message: "Product updated" };
});

const categorySchema = z.object({ code: zStr(20), name: zStr(80), storageType: z.enum(["CHILLED", "FROZEN", "AMBIENT"]), defaultShelfLifeHours: zOptNum({ min: 1, int: true }), sortOrder: zOptNum({ int: true }) });

export const createCategoryAction = defineAction({ permission: "products.manage", schema: categorySchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    if (await tx.productCategory.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: input.code.toUpperCase() } } })) throw new AppError("Category code already exists", {}, "code");
    const c = await tx.productCategory.create({ data: { tenantId: ctx.tenantId, ...input, code: input.code.toUpperCase(), defaultShelfLifeHours: input.defaultShelfLifeHours ?? null, sortOrder: input.sortOrder ?? 10 } });
    await audit(tx, ctx, { action: "category.create", entityType: "product_category", entityId: c.id, summary: c.name });
  });
  return { ok: true, message: "Category created" };
});

const labelSchema = z.object({ inventoryId: zId, templateId: zOptStr(40), weights: zStr(10000), copies: zOptNum({ min: 1, max: 10, int: true }) });

export const createLabelsAction = defineAction({ permission: "products.operate", schema: labelSchema }, async (ctx, input) => {
  const weights = input.weights
    .split(/[\s;,\n]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => {
      const m = w.match(/^(\d+)\s*[x×*]\s*([\d.]+)$/i);
      return m ? Array.from({ length: Number(m[1]) }, () => Number(m[2])) : [Number(w)];
    })
    .flat();
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) throw new AppError("Enter pack weights in kg separated by spaces or new lines (e.g. 1.245 1.180, or 20x0.5)", {}, "weights");
  const labels = await withTenant(ctx, (tx) => createLabels(tx, ctx, { inventoryId: input.inventoryId, templateId: input.templateId, weights, copies: input.copies ?? 1 }));
  return { ok: true, message: "{n} label(s) generated", params: { n: labels.length }, redirectTo: `/print/labels?ids=${labels.map((l) => l.id).join(",")}` };
});

const templateSchema = z.object({ name: zStr(80), widthMm: zNum({ min: 20, max: 200, int: true }), heightMm: zNum({ min: 15, max: 300, int: true }), layout: z.enum(["COMPACT", "STANDARD", "LARGE"]), showPrice: zBool, showQr: zBool, showBarcode: zBool });

export const createTemplateAction = defineAction({ permission: "products.manage", schema: templateSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const t = await tx.labelTemplate.create({ data: { tenantId: ctx.tenantId, ...input } });
    await audit(tx, ctx, { action: "label_template.create", entityType: "label_template", entityId: t.id, summary: t.name });
  });
  return { ok: true, message: "Label template created" };
});
