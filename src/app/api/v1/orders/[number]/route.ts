import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { num } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { apiAuth, apiRun } from "@/server/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  const ctx = await apiAuth(req, "orders:read");
  if (ctx instanceof NextResponse) return ctx;
  const { number } = await params;
  return apiRun(ctx, async (tx) => {
    const o = await tx.order.findUnique({
      where: { tenantId_number: { tenantId: ctx.tenantId, number } },
      include: { customer: true, history: { orderBy: { createdAt: "asc" } }, items: { include: { product: true, allocations: { where: { status: { not: "RELEASED" } }, include: { inventory: { include: { batch: true } } } } } } },
    });
    if (!o) throw new AppError("Order not found");
    return {
      number: o.number,
      customer_code: o.customer.code,
      status: o.status,
      delivery_date: o.requestedDeliveryDate.toISOString().slice(0, 10),
      delivered_at: o.deliveredAt?.toISOString() ?? null,
      on_time: o.onTime,
      in_full: o.inFull,
      total: num(o.total),
      items: o.items.map((i) => ({
        sku: i.product.sku,
        quantity_kg: i.quantityKg,
        delivered_kg: i.deliveredKg,
        batches: i.allocations.map((a) => ({ batch: a.inventory.batch.code, quantity_kg: a.quantityKg, expiry: a.inventory.expiryDate.toISOString() })),
      })),
      history: o.history.map((h) => ({ status: h.toStatus, at: h.createdAt.toISOString() })),
    };
  });
}
