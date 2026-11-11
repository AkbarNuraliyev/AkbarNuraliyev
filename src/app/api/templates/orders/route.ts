import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { addDaysKey, localDateKey } from "@/lib/tz";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s?.tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [c, p] = await withTenant({ tenantId: s.tenant.id }, (tx) => Promise.all([tx.customer.findFirst({ orderBy: { code: "asc" } }), tx.product.findMany({ take: 2, orderBy: { sku: "asc" } })]));
  const d = addDaysKey(localDateKey(new Date(), s.tenant.timezone), 1);
  const lines = ["customer_code,delivery_date,sku,quantity_kg,external_ref,notes"];
  for (const prod of p) lines.push(`${c?.code ?? "C001"},${d},${prod.sku},100,PO-1001,`);
  return new NextResponse("﻿" + lines.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="orders-import-template.csv"' } });
}
