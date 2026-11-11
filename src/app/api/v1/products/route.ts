import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { num } from "@/lib/format";
import { apiAuth, apiRun } from "@/server/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await apiAuth(req, "products:read");
  if (ctx instanceof NextResponse) return ctx;
  return apiRun(ctx, async (tx) => {
    const products = await tx.product.findMany({ where: { isActive: true }, include: { category: true }, orderBy: { sku: "asc" } });
    return products.map((p) => ({
      sku: p.sku,
      name: p.name,
      category: p.category.name,
      storage: p.storageType,
      shelf_life_hours: p.shelfLifeHours,
      variable_weight: p.isVariableWeight,
      net_weight_kg: p.netWeightKg,
      price: num(p.price),
      plu: p.pluCode,
      barcode: p.barcode,
    }));
  });
}
