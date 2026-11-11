"use server";

import { z } from "zod";
import { defineAction, zBool, zEmail, zId, zNum, zOptNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit, diff } from "@/server/core";
import { recordReturn } from "@/server/services/retail";
import { createInvitation } from "@/server/services/users";
import { appUrl, sendEmail } from "@/server/services/email";

const customerSchema = z.object({
  code: zStr(20),
  name: zStr(160),
  type: z.enum(["HORECA", "RETAIL_CHAIN", "DISTRIBUTOR", "WHOLESALE", "OTHER"]),
  taxId: zOptStr(20),
  contactName: zOptStr(120),
  phone: zOptStr(40),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")).transform((v) => v || null),
  address: zOptStr(300),
  deliveryAddress: zOptStr(300),
  region: zOptStr(80),
  creditLimit: zOptNum({ min: 0 }),
  paymentTermsDays: zNum({ min: 0, max: 365, int: true }),
  priceListId: zOptStr(40),
});

export const createCustomerAction = defineAction({ permission: "sales.manage", schema: customerSchema }, async (ctx, input) => {
  const id = await withTenant(ctx, async (tx) => {
    const code = input.code.toUpperCase();
    if (await tx.customer.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } })) throw new AppError("Customer code already exists", {}, "code");
    const c = await tx.customer.create({ data: { tenantId: ctx.tenantId, ...input, code, creditLimit: input.creditLimit ?? null, priceListId: input.priceListId || null } });
    await audit(tx, ctx, { action: "customer.create", entityType: "customer", entityId: c.id, summary: `${c.code} ${c.name}` });
    return c.id;
  });
  return { ok: true, message: "Customer created", redirectTo: `/app/sales/customers/${id}` };
});

const customerUpdateSchema = customerSchema.extend({ id: zId, isActive: zBool });
export const updateCustomerAction = defineAction({ permission: "sales.manage", schema: customerUpdateSchema }, async (ctx, input) => {
  const { id, ...rest } = input;
  await withTenant(ctx, async (tx) => {
    const before = await tx.customer.findUniqueOrThrow({ where: { id } });
    const code = rest.code.toUpperCase();
    const dup = await tx.customer.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } });
    if (dup && dup.id !== id) throw new AppError("Customer code already exists", {}, "code");
    const after = await tx.customer.update({ where: { id }, data: { ...rest, code, creditLimit: rest.creditLimit ?? null, priceListId: rest.priceListId || null } });
    await audit(tx, ctx, { action: "customer.update", entityType: "customer", entityId: id, summary: after.name, changes: diff(before as never, after as never) });
  });
  return { ok: true, message: "Customer updated" };
});

const priceListSchema = z.object({ name: zStr(80), copyFromId: zOptStr(40), factor: zOptNum({ min: 0.1, max: 3 }) });
export const createPriceListAction = defineAction({ permission: "sales.manage", schema: priceListSchema }, async (ctx, input) => {
  const id = await withTenant(ctx, async (tx) => {
    if (await tx.priceList.findUnique({ where: { tenantId_name: { tenantId: ctx.tenantId, name: input.name } } })) throw new AppError("A price list with this name exists", {}, "name");
    const pl = await tx.priceList.create({ data: { tenantId: ctx.tenantId, name: input.name } });
    const factor = input.factor ?? 1;
    if (input.copyFromId) {
      const items = await tx.priceListItem.findMany({ where: { priceListId: input.copyFromId } });
      await tx.priceListItem.createMany({ data: items.map((i) => ({ tenantId: ctx.tenantId, priceListId: pl.id, productId: i.productId, price: Math.round(Number(i.price) * factor) })) });
    } else {
      const products = await tx.product.findMany({ where: { isActive: true } });
      await tx.priceListItem.createMany({ data: products.map((p) => ({ tenantId: ctx.tenantId, priceListId: pl.id, productId: p.id, price: Math.round(Number(p.price) * factor) })) });
    }
    await audit(tx, ctx, { action: "price_list.create", entityType: "price_list", entityId: pl.id, summary: pl.name });
    return pl.id;
  });
  return { ok: true, message: "Price list created", redirectTo: `/app/sales/price-lists?list=${id}` };
});

const savePricesSchema = z.object({ priceListId: zId });
export const savePricesAction = defineAction({ permission: "sales.manage", schema: savePricesSchema }, async (ctx, input, fd) => {
  let changed = 0;
  await withTenant(ctx, async (tx) => {
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("price_") || typeof v !== "string") continue;
      const productId = k.slice(6);
      if (v.trim() === "") {
        const del = await tx.priceListItem.deleteMany({ where: { priceListId: input.priceListId, productId } });
        changed += del.count;
        continue;
      }
      const price = Number(v.replace(",", "."));
      if (!Number.isFinite(price) || price < 0) throw new AppError("Prices must be zero or positive numbers");
      const existing = await tx.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: input.priceListId, productId } } });
      if (existing && Number(existing.price) === price) continue;
      await tx.priceListItem.upsert({
        where: { priceListId_productId: { priceListId: input.priceListId, productId } },
        update: { price },
        create: { tenantId: ctx.tenantId, priceListId: input.priceListId, productId, price },
      });
      changed++;
    }
    await audit(tx, ctx, { action: "price_list.update", entityType: "price_list", entityId: input.priceListId, summary: `${changed} price(s) changed` });
  });
  return { ok: true, message: "{n} price(s) updated", params: { n: changed } };
});

const returnSchema = z.object({
  customerId: zId,
  orderId: zOptStr(40),
  productId: zId,
  batchId: zId,
  quantityKg: zNum({ min: 0.001 }),
  reason: zStr(500),
  action: z.enum(["RESTOCK", "WRITE_OFF"]),
  restockWarehouseId: zOptStr(40),
  restockChamberId: zOptStr(40),
});
export const recordB2BReturnAction = defineAction({ permission: "sales.operate", schema: returnSchema }, async (ctx, input) => {
  const r = await withTenant(ctx, (tx) => recordReturn(tx, ctx, { ...input, source: "B2B" }));
  return { ok: true, message: "Return {n} recorded", params: { n: r.number } };
});

const inviteSchema = z.object({ customerId: zId, email: zEmail });
export const invitePortalUserAction = defineAction({ permission: "sales.manage", feature: "b2b_portal", schema: inviteSchema }, async (ctx, input) => {
  const { token } = await withTenant(ctx, async (tx) => {
    const role = await tx.role.findFirstOrThrow({ where: { isPortal: true } });
    return createInvitation(tx, ctx, { email: input.email, roleId: role.id, customerId: input.customerId, tenantName: ctx.tenant.name });
  });
  const link = appUrl(`/invite/${token}`);
  const r = await sendEmail({ to: input.email, subject: `${ctx.tenant.name}: B2B ordering portal invitation`, body: `You have been invited to order from ${ctx.tenant.name} in the PoultryOS B2B portal.\n\nAccept the invitation (valid 7 days): ${link}\n`, tenantId: ctx.tenantId });
  return {
    ok: true,
    message: r.sent ? "Invitation e-mailed to {email}" : "Invitation created. E-mail is not configured — copy the link below and share it securely.",
    params: { email: input.email, link },
    data: r.sent ? undefined : { link },
  };
});
