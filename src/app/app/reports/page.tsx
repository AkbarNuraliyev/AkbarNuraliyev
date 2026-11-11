import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtKg, fmtMoney, fmtMoneyShort, fmtNum, fmtPct, pct, round } from "@/lib/format";
import { Card, CardHeader, ExportLinks, Kpi, PageHeader, Tabs } from "@/components/ui/basic";
import { RangeFilter, Toolbar } from "@/components/ui/controls";
import { BarChartView, DotPlot, LineChartView } from "@/components/charts";
import { qs, SimpleTable, spGet, type SP } from "@/components/ui/table";
import {
  dashboardKpis, deliveryPerformance, demandVsProduction, expiryRisk, inventoryByWarehouse, parseRange, productionByDay, productionByProduct, rangeBounds,
  retailSalesSummary, salesByDay, supplierPerformance, temperatureExcursions, yieldByFarm, yieldByShift,
} from "@/server/services/analytics";
import { planVsActual } from "@/server/services/forecast";

const TABS = ["production", "sales", "inventory", "logistics", "quality", "suppliers"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "reports.view" });
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(spGet(sp, "tab") ?? "") ? (spGet(sp, "tab") as (typeof TABS)[number]) : "production";
  const now = new Date();
  const range = parseRange(sp, ctx.tz, now, "30d");
  const { from, to } = rangeBounds(range);
  const t = ctx.t;
  const q = qs(sp, { tab: null });
  const cur = ctx.tenant.currency;

  const body = await withTenant(ctx, async (tx) => {
    const k = await dashboardKpis(tx, range, now, ctx.settings);
    if (tab === "production") {
      const [days, products, farms, shifts, pva] = await Promise.all([productionByDay(tx, range), productionByProduct(tx, range, 15), yieldByFarm(tx, range, 20), yieldByShift(tx, range, 60), planVsActual(tx, ctx, range.fromKey, range.toKey)]);
      return (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Kpi label={t("Live input")} value={fmtKg(k.inputKg, 0)} />
            <Kpi label={t("Birds processed")} value={fmtNum(k.birds)} />
            <Kpi label={t("Saleable output")} value={fmtKg(k.productionKg, 0)} />
            <Kpi label={t("Total yield")} value={fmtPct(k.yieldPct, 2)} />
            <Kpi label={t("Waste")} value={fmtPct(k.wastePct, 2)} />
            <Kpi label={t("Shifts")} value={String(shifts.length)} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title={t("Production by day")} description="kg" actions={<ExportLinks report="outputs" query={q} />} /><BarChartView data={days} xKey="day" stacked unit="kg" series={[{ key: "products", label: "Products" }, { key: "byproducts", label: "By-products" }, { key: "waste", label: "Waste", color: "#98a2b3" }]} /></Card>
            <Card><CardHeader title={t("Yield and waste trend")} description="%" /><LineChartView data={days} xKey="day" unit="%" digits={2} series={[{ key: "yieldPct", label: "Total yield" }, { key: "wastePct", label: "Waste" }]} /></Card>
            <Card><CardHeader title={t("Production by product")} description="kg" /><BarChartView data={products} xKey="name" horizontal unit="kg" series={[{ key: "kg", label: "Output" }]} height={360} /></Card>
            <Card><CardHeader title={t("Yield by farm")} actions={<ExportLinks report="yield-by-farm" query={q} />} /><DotPlot data={farms.map((f) => ({ label: `${f.code} · ${f.name}`, value: f.yieldPct, secondary: f.wastePct }))} secondaryLabel={t("waste")} /></Card>
            <Card><CardHeader title={t("Planned vs actual production")} description="kg" actions={<ExportLinks report="plans" query={q} />} /><LineChartView data={pva} xKey="day" unit="kg" series={[{ key: "forecast", label: "Forecast" }, { key: "planned", label: "Planned" }, { key: "actual", label: "Actual" }]} /></Card>
            <Card>
              <CardHeader title={t("Shift performance")} actions={<ExportLinks report="shifts" query={q} />} />
              <div className="max-h-[300px] overflow-y-auto">
                <SimpleTable head={[t("Shift"), t("Input kg"), t("Yield"), t("Waste"), t("Unexplained")]}>
                  {[...shifts].reverse().map((s) => (
                    <tr key={s.id}>
                      <td className="td"><Link href={`/app/production/shifts/${s.id}`} className="link">{s.number}</Link> <span className="text-[11px] text-ink-3">{s.shiftType}</span></td>
                      <td className="td tabular">{fmtNum(s.input)}</td>
                      <td className="td tabular">{fmtPct(s.yieldPct, 2)}</td>
                      <td className="td tabular">{fmtPct(s.wastePct, 2)}</td>
                      <td className={`td tabular ${Math.abs(s.unexplainedPct) > ctx.settings.massBalanceTolerancePct ? "font-medium text-red-700" : ""}`}>{fmtPct(s.unexplainedPct, 2)}</td>
                    </tr>
                  ))}
                </SimpleTable>
              </div>
            </Card>
          </div>
        </>
      );
    }
    if (tab === "sales") {
      const [days, retail, top, demand] = await Promise.all([
        salesByDay(tx, range),
        retailSalesSummary(tx, range),
        tx.$queryRaw<{ name: string; v: number; kg: number }[]>`
          SELECT c.name, SUM(i.amount)::float AS v, 0::float AS kg FROM sales_invoices i JOIN customers c ON c.id = i."customerId"
          WHERE i."issuedAt" >= ${from} AND i."issuedAt" < ${to} AND i.status <> 'VOID' GROUP BY c.name ORDER BY v DESC LIMIT 12`,
        demandVsProduction(tx, range),
      ]);
      return (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={t("Total sales")} value={fmtMoneyShort(k.sales, cur)} />
            <Kpi label={t("B2B invoiced")} value={fmtMoneyShort(k.salesB2b, cur)} />
            <Kpi label={t("Retail")} value={fmtMoneyShort(k.salesRetail, cur)} />
            <Kpi label={t("Outstanding receivables")} value={fmtMoneyShort(k.receivables, cur)} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title={t("Sales trend")} description={cur} actions={<ExportLinks report="sales-daily" query={q} />} /><LineChartView data={days} xKey="day" unit={cur} digits={0} series={[{ key: "b2b", label: "B2B invoiced" }, { key: "retail", label: "Retail" }]} /></Card>
            <Card><CardHeader title={t("Demand vs actual production")} description="kg" /><LineChartView data={demand} xKey="day" unit="kg" series={[{ key: "demand", label: "Demand" }, { key: "produced", label: "Produced" }]} /></Card>
            <Card><CardHeader title={t("Top B2B customers")} description={cur} actions={<ExportLinks report="receivables" />} /><BarChartView data={top.map((x) => ({ name: x.name.replace(" (demo)", ""), v: Math.round(x.v) }))} xKey="name" horizontal unit={cur} digits={0} series={[{ key: "v", label: "Invoiced" }]} height={340} /></Card>
            <Card><CardHeader title={t("Retail sales by location")} description={cur} actions={<ExportLinks report="sales" query={q} />} /><BarChartView data={retail.byLocation.map((x) => ({ name: x.name.replace(" (demo)", ""), total: Math.round(x.total) }))} xKey="name" horizontal unit={cur} digits={0} series={[{ key: "total", label: "Sales" }]} height={340} /></Card>
            <Card className="lg:col-span-2">
              <CardHeader title={t("Retail sales by product")} />
              <SimpleTable head={[t("Product"), t("kg"), t("Revenue"), t("Avg price / kg")]}>
                {retail.byProduct.map((p) => (
                  <tr key={p.productId}><td className="td">{p.name}</td><td className="td tabular">{fmtNum(p.kg, 1)}</td><td className="td tabular">{fmtMoney(p.total)}</td><td className="td tabular">{p.kg ? fmtMoney(p.total / p.kg) : "—"}</td></tr>
                ))}
              </SimpleTable>
            </Card>
          </div>
        </>
      );
    }
    if (tab === "inventory") {
      const [wh, risk, writeoffs, moves] = await Promise.all([
        inventoryByWarehouse(tx, now),
        expiryRisk(tx, now),
        tx.inventoryMovement.groupBy({ by: ["type"], where: { createdAt: { gte: from, lt: to }, type: { in: ["WRITE_OFF", "DAMAGE", "EXPIRED"] } }, _sum: { quantityKg: true } }),
        tx.inventoryMovement.groupBy({ by: ["type"], where: { createdAt: { gte: from, lt: to } }, _sum: { quantityKg: true }, _count: true }),
      ]);
      const written = -writeoffs.reduce((s, w) => s + (w._sum.quantityKg ?? 0), 0);
      return (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={t("Chilled stock")} value={fmtKg(k.chilledKg, 0)} />
            <Kpi label={t("Frozen stock")} value={fmtKg(k.frozenKg, 0)} />
            <Kpi label={t("Inventory valuation")} value={fmtMoneyShort(wh.reduce((s, w) => s + w.value, 0), cur)} />
            <Kpi label={t("Written off in period")} value={fmtKg(written, 0)} sub={k.productionKg ? `${fmtPct(pct(written, k.productionKg), 2)} ${t("of production")}` : undefined} tone={written > 0 ? "warning" : "good"} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title={t("Stock by warehouse")} description="kg" actions={<ExportLinks report="inventory" />} /><BarChartView data={wh} xKey="name" horizontal stacked unit="kg" series={[{ key: "chilled", label: "Chilled" }, { key: "frozen", label: "Frozen" }, { key: "blocked", label: "Blocked", color: "#d03b3b" }]} height={Math.max(240, wh.length * 28)} /></Card>
            <Card><CardHeader title={t("Expiration risk")} description="kg" /><BarChartView data={risk.map((r) => ({ ...r, label: t(r.label) }))} xKey="label" series={[{ key: "kg", label: "Stock" }]} unit="kg" /></Card>
            <Card className="lg:col-span-2">
              <CardHeader title={t("Inventory movements in period")} actions={<ExportLinks report="movements" query={q} />} />
              <SimpleTable head={[t("Movement type"), t("Movements"), t("Net quantity")]}>
                {moves.map((m) => (
                  <tr key={m.type}><td className="td">{t(m.type.replaceAll("_", " ").toLowerCase())}</td><td className="td tabular">{fmtNum(m._count)}</td><td className="td tabular">{fmtKg(m._sum.quantityKg ?? 0, 1)}</td></tr>
                ))}
              </SimpleTable>
            </Card>
          </div>
        </>
      );
    }
    if (tab === "logistics") {
      const [perf, temps, ship] = await Promise.all([
        deliveryPerformance(tx, range),
        temperatureExcursions(tx, range),
        tx.shipment.groupBy({ by: ["status"], where: { plannedDeparture: { gte: from, lt: to } }, _count: true }),
      ]);
      return (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="OTIF" value={k.otifPct === null ? "—" : fmtPct(k.otifPct)} />
            <Kpi label={t("Delivered orders")} value={fmtNum(k.deliveredOrders)} />
            <Kpi label={t("Shipments")} value={fmtNum(ship.reduce((s, x) => s + x._count, 0))} />
            <Kpi label={t("Cold-chain excursions")} value={fmtNum(k.coldChainAlerts)} tone={k.coldChainAlerts ? "critical" : "good"} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title={t("Delivery performance")} description="%" actions={<ExportLinks report="shipments" query={q} />} /><LineChartView data={perf} xKey="day" unit="%" series={[{ key: "otifPct", label: "OTIF" }, { key: "onTimePct", label: "On time" }, { key: "inFullPct", label: "In full" }]} /></Card>
            <Card><CardHeader title={t("Temperature excursions")} actions={<ExportLinks report="temperature" query={q} />} /><BarChartView data={temps} xKey="day" stacked digits={0} series={[{ key: "chamber", label: "Storage chambers" }, { key: "vehicle", label: "Vehicles" }]} /></Card>
          </div>
        </>
      );
    }
    if (tab === "quality") {
      const [byType, ncs, returns] = await Promise.all([
        tx.$queryRaw<{ type: string; pass: number; fail: number }[]>`
          SELECT c.type::text AS type, SUM(CASE WHEN r.result = 'PASS' THEN 1 ELSE 0 END)::int AS pass, SUM(CASE WHEN r.result = 'FAIL' THEN 1 ELSE 0 END)::int AS fail
          FROM quality_records r JOIN quality_checklists c ON c.id = r."checklistId" WHERE r."performedAt" >= ${from} AND r."performedAt" < ${to} GROUP BY 1 ORDER BY 1`,
        tx.nonconformity.groupBy({ by: ["severity", "status"], where: { createdAt: { gte: from, lt: to } }, _count: true }),
        tx.returnRecord.groupBy({ by: ["source"], where: { createdAt: { gte: from, lt: to } }, _sum: { quantityKg: true }, _count: true }),
      ]);
      return (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={t("Inspections")} value={fmtNum(byType.reduce((s, x) => s + x.pass + x.fail, 0))} />
            <Kpi label={t("Failed")} value={fmtNum(byType.reduce((s, x) => s + x.fail, 0))} />
            <Kpi label={t("Non-conformities opened")} value={fmtNum(ncs.reduce((s, x) => s + x._count, 0))} />
            <Kpi label={t("Customer returns")} value={fmtKg(k.returnsKg, 1)} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title={t("Inspections by checklist type")} actions={<ExportLinks report="quality" query={q} />} /><BarChartView data={byType} xKey="type" stacked digits={0} series={[{ key: "pass", label: "Pass", color: "#1baf7a" }, { key: "fail", label: "Fail", color: "#e34948" }]} /></Card>
            <Card>
              <CardHeader title={t("Non-conformities")} actions={<ExportLinks report="nonconformities" />} />
              <SimpleTable head={[t("Severity"), t("Status"), t("Count")]}>
                {ncs.map((n, i) => <tr key={i}><td className="td">{t(n.severity.charAt(0) + n.severity.slice(1).toLowerCase())}</td><td className="td">{t(n.status.charAt(0) + n.status.slice(1).toLowerCase())}</td><td className="td tabular">{n._count}</td></tr>)}
              </SimpleTable>
              <div className="mt-3 text-[12.5px] text-ink-3">{returns.map((r) => `${r.source}: ${r._count} / ${fmtKg(r._sum.quantityKg ?? 0, 1)}`).join(" · ")}</div>
            </Card>
          </div>
        </>
      );
    }
    const sup = await supplierPerformance(tx, range);
    return (
      <Card>
        <CardHeader title={t("Supplier comparison")} actions={<ExportLinks report="supplier-performance" query={q} />} />
        <SimpleTable head={[t("Supplier"), t("Deliveries"), t("Accepted kg"), t("Acceptance"), t("DOA"), t("Avg bird kg"), t("Yield")]}>
          {sup.map((s) => (
            <tr key={s.id}>
              <td className="td"><Link className="link" href={`/app/procurement/suppliers/${s.id}`}>{s.name}</Link></td>
              <td className="td tabular">{s.deliveries}</td>
              <td className="td tabular">{fmtNum(s.acceptedKg)}</td>
              <td className="td tabular">{fmtPct(pct(s.accepted, s.birds), 2)}</td>
              <td className="td tabular">{fmtPct(pct(s.doa, s.birds), 2)}</td>
              <td className="td tabular">{round(s.avgBird, 3)}</td>
              <td className="td tabular font-medium">{s.input ? fmtPct(pct(s.saleable, s.input), 2) : "—"}</td>
            </tr>
          ))}
        </SimpleTable>
      </Card>
    );
  });
  return (
    <>
      <PageHeader title={t("Reports & Analytics")} description={t("All figures are calculated from operational records for the selected period. Every report can be downloaded as CSV or Excel.")} actions={<ExportLinks report="dashboard" query={q} />} />
      <Tabs current={tab} tabs={TABS.map((x) => ({ key: x, href: `/app/reports${qs(sp, { tab: x })}`, label: t(x.charAt(0).toUpperCase() + x.slice(1)) }))} />
      <Toolbar><RangeFilter options={["7d", "30d", "90d"]} /></Toolbar>
      {body}
    </>
  );
}
