import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { apiAuth, apiRun } from "@/server/api";
import { traceBatch } from "@/server/services/traceability";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const ctx = await apiAuth(req, "trace:read");
  if (ctx instanceof NextResponse) return ctx;
  const { code } = await params;
  return apiRun(ctx, async (tx) => {
    const b = await tx.productionBatch.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } });
    if (!b) throw new AppError("Batch not found");
    const tr = (await traceBatch(tx, b.id))!;
    return {
      batch: b.code,
      status: b.status,
      farm: { code: tr.batch.farm.code, name: tr.batch.farm.name, region: tr.batch.farm.region },
      supplier: tr.batch.supplier.name,
      received_at: tr.batch.receipt.receivedAt.toISOString(),
      live_weight_kg: tr.batch.liveWeightKg,
      shifts: tr.shifts.map((s) => ({ shift: s.shift.number, line: s.shift.line.code, input_kg: s.inputWeightKg })),
      products: tr.products.map((p) => ({ sku: p.sku, kg: p.kg })),
      in_stock_kg: tr.inventoryKg,
      customers: tr.customers.map((c) => ({ code: c.code, kg: c.kg, orders: c.orders })),
      shipments: tr.shipments.map((s) => ({ number: s.number, vehicle: s.vehicle, status: s.status })),
      recalls: tr.batch.recalls.map((r) => ({ number: r.number, status: r.status })),
    };
  });
}
