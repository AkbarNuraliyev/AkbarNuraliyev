import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtKg, fmtNum, fmtPct, pct, round } from "@/lib/format";
import { Card, CardHeader, ExportLinks, PageHeader } from "@/components/ui/basic";
import { RangeFilter } from "@/components/ui/controls";
import { BarChartView } from "@/components/charts";
import { qs, SimpleTable, type SP } from "@/components/ui/table";
import { parseRange, supplierPerformance } from "@/server/services/analytics";
import { ProcurementTabs } from "../tabs";

export default async function PerformancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "procurement.view" });
  const sp = await searchParams;
  const range = parseRange(sp, ctx.tz, new Date(), "30d");
  const rows = await withTenant(ctx, (tx) => supplierPerformance(tx, range));
  const t = ctx.t;
  const data = rows.map((r) => ({
    ...r,
    acceptance: pct(r.accepted, r.birds),
    doaPct: pct(r.doa, r.birds),
    yieldPct: r.input ? pct(r.saleable, r.input) : null,
  }));
  return (
    <>
      <PageHeader
        title={t("Procurement & Farms")}
        description={t("Compare suppliers by acceptance rate, mortality on arrival, live weight and downstream production yield.")}
        actions={
          <>
            <RangeFilter options={["7d", "30d", "90d"]} />
            <ExportLinks report="supplier-performance" query={qs(sp, {})} />
          </>
        }
      />
      <ProcurementTabs current="performance" t={t} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Yield by supplier")} description={t("Saleable output ÷ processed live weight, %")} />
          <BarChartView data={data.filter((d) => d.yieldPct !== null).map((d) => ({ name: d.name, yieldPct: round(d.yieldPct!, 2) }))} xKey="name" horizontal series={[{ key: "yieldPct", label: "Yield" }]} unit="%" digits={2} height={Math.max(240, data.length * 22)} />
        </Card>
        <Card>
          <CardHeader title={t("Accepted live weight by supplier")} description="kg" />
          <BarChartView data={data.map((d) => ({ name: d.name, kg: round(d.acceptedKg, 0) }))} xKey="name" horizontal series={[{ key: "kg", label: "Accepted" }]} unit="kg" height={Math.max(240, data.length * 22)} />
        </Card>
      </div>
      <div className="mt-4">
        <SimpleTable head={[t("Supplier"), t("Deliveries"), t("Birds"), t("Acceptance"), t("DOA"), t("Avg live weight"), t("Accepted kg"), t("Deliveries with rejection"), t("Yield")]}>
          {data.map((r) => (
            <tr key={r.id}>
              <td className="td"><Link href={`/app/procurement/suppliers/${r.id}`} className="link">{r.name}</Link></td>
              <td className="td tabular">{r.deliveries}</td>
              <td className="td tabular">{fmtNum(r.birds)}</td>
              <td className="td tabular">{fmtPct(r.acceptance, 2)}</td>
              <td className="td tabular">{fmtPct(r.doaPct, 2)}</td>
              <td className="td tabular">{fmtKg(r.avgBird, 3)}</td>
              <td className="td tabular">{fmtKg(r.acceptedKg, 0)}</td>
              <td className="td tabular">{r.rejectedDeliveries}</td>
              <td className="td tabular font-medium">{r.yieldPct === null ? "—" : fmtPct(r.yieldPct, 2)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td className="td text-center text-ink-3" colSpan={9}>{t("No deliveries in the selected period")}</td>
            </tr>
          )}
        </SimpleTable>
      </div>
    </>
  );
}
