import { NextResponse, type NextRequest } from "next/server";
import { getSession, featureOfPermission } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { ALWAYS_ON_FEATURES } from "@/lib/modules";
import { EXPORTS, toCsv, toXlsx } from "@/server/exports";
import { audit } from "@/server/core";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const def = EXPORTS[report];
  if (!def) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const s = await getSession();
  if (!s?.tenant || !s.membership || s.membership.isPortal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.tenant.status === "SUSPENDED") return NextResponse.json({ error: "Organization suspended" }, { status: 403 });
  if (!s.permissions.has(def.permission)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const feature = def.feature ?? featureOfPermission(def.permission);
  if (feature && !ALWAYS_ON_FEATURES.has(feature) && !s.features.has(feature)) return NextResponse.json({ error: "Not included in plan" }, { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const ctx = { tenantId: s.tenant.id, tz: s.tenant.timezone, settings: s.tenant.settings, userId: s.user.id, userEmail: s.user.email, userName: s.user.name };
  const rows = await withTenant(ctx, async (tx) => {
    const r = await def.build(tx, ctx, sp);
    await audit(tx, ctx, { action: "export", entityType: report, summary: `${def.title}: ${r.length} rows (${sp.format === "xlsx" ? "xlsx" : "csv"})` });
    return r;
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `poultryos-${report}-${stamp}`;
  if (sp.format === "xlsx") {
    const buf = await toXlsx(def.title, rows);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }
  return new NextResponse(toCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });
}
