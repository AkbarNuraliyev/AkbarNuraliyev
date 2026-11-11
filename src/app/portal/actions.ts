"use server";

import { z } from "zod";
import { defineAction, zDate, zJson, zOptStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createOrder } from "@/server/services/orders";

const schema = z.object({
  requestedDeliveryDate: zDate,
  notes: zOptStr(1000),
  items: zJson(z.array(z.object({ productId: z.string().min(1), quantityKg: z.number().positive("Quantities must be greater than zero") })).min(1, "Add at least one product to the order")),
});

/** Portal ordering: the customer is always taken from the session, never from the form. */
export const createPortalOrderAction = defineAction({ portal: true, feature: "b2b_portal", schema }, async (ctx, input) => {
  const customerId = ctx.session.membership?.customerId;
  if (!customerId) throw new AppError("Your account is not linked to a customer");
  const order = await withTenant(ctx, (tx) =>
    createOrder(tx, ctx, { customerId, requestedDeliveryDate: input.requestedDeliveryDate, notes: input.notes, source: "PORTAL", items: input.items, restrictToPriceList: true }),
  );
  return { ok: true, message: "Order {n} submitted", params: { n: order.number }, redirectTo: `/portal/orders/${order.id}` };
});
