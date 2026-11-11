import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { round } from "@/lib/format";
import { apiAuth, apiRun } from "@/server/api";
import { EPS } from "@/server/services/inventory";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await apiAuth(req, "inventory:read");
  if (ctx instanceof NextResponse) return ctx;
  const sku = req.nextUrl.searchParams.get("sku");
  return apiRun(ctx, async (tx) => {
    const lots = await tx.inventory.findMany({
      where: { quantityKg: { gt: EPS }, status: "AVAILABLE", expiryDate: { gt: new Date() }, warehouse: { type: { not: "RETAIL" } }, ...(sku ? { product: { sku } } : {}) },
      include: { product: true, batch: true, warehouse: true },
      orderBy: [{ product: { sku: "asc" } }, { expiryDate: "asc" }],
      take: 2000,
    });
    return lots.map((l) => ({
      sku: l.product.sku,
      batch: l.batch.code,
      warehouse: l.warehouse.code,
      quantity_kg: round(l.quantityKg, 3),
      available_kg: round(l.quantityKg - l.reservedKg, 3),
      production_date: l.productionDate.toISOString(),
      expiry_date: l.expiryDate.toISOString(),
    }));
  });
}
