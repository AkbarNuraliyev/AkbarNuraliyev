import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { num } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { apiAuth, apiError, apiRun } from "@/server/api";
import { createOrder } from "@/server/services/orders";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await apiAuth(req, "orders:read");
  if (ctx instanceof NextResponse) return ctx;
  const status = req.nextUrl.searchParams.get("status");
  const since = req.nextUrl.searchParams.get("since");
  return apiRun(ctx, async (tx) => {
    const orders = await tx.order.findMany({
      where: { ...(status ? { status: status as "NEW" } : {}), ...(since ? { createdAt: { gte: new Date(since) } } : {}) },
      include: { customer: true, items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return orders.map((o) => ({
      number: o.number,
      customer_code: o.customer.code,
      status: o.status,
      source: o.source,
      external_ref: o.externalRef,
      delivery_date: o.requestedDeliveryDate.toISOString().slice(0, 10),
      total: num(o.total),
      items: o.items.map((i) => ({ sku: i.product.sku, quantity_kg: i.quantityKg, delivered_kg: i.deliveredKg, unit_price: num(i.unitPrice) })),
    }));
  });
}

const bodySchema = z.object({
  customer_code: z.string().min(1),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  external_ref: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(z.object({ sku: z.string().min(1), quantity_kg: z.number().positive() })).min(1).max(200),
});

export async function POST(req: NextRequest) {
  const ctx = await apiAuth(req, "orders:write");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, `Invalid body: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const b = parsed.data;
  return apiRun(
    ctx,
    async (tx) => {
      const customer = await tx.customer.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: b.customer_code } } });
      if (!customer) throw new AppError("Unknown customer_code {c}", { c: b.customer_code });
      if (b.external_ref) {
        const dup = await tx.order.findFirst({ where: { customerId: customer.id, externalRef: b.external_ref, status: { not: "CANCELLED" } } });
        if (dup) return { number: dup.number, status: dup.status, duplicate: true };
      }
      const products = await tx.product.findMany({ where: { sku: { in: b.items.map((i) => i.sku) } } });
      const items = b.items.map((i) => {
        const p = products.find((x) => x.sku === i.sku);
        if (!p) throw new AppError("Unknown sku {s}", { s: i.sku });
        return { productId: p.id, quantityKg: i.quantity_kg };
      });
      const o = await createOrder(tx, ctx, { customerId: customer.id, requestedDeliveryDate: b.delivery_date, externalRef: b.external_ref, notes: b.notes, source: "API", items });
      return { number: o.number, status: o.status, total: num(o.total) };
    },
    201,
  );
}
