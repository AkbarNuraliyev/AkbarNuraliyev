import Link from "@/components/ui/link";
import { notificationParams } from "@/lib/notifications";
import { Download } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtMoneyShort, fmtNum, fmtPct, fmtWeight } from "@/lib/format";
import { addDaysKey } from "@/lib/tz";
import { Card, CardHeader, Kpi, PageHeader, LinkButton } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { RangeFilter } from "@/components/ui/controls";
import { BarChartView, DotPlot, LineChartView } from "@/components/charts";
import type { SP } from "@/components/ui/table";
import {
  dashboardKpis, demandVsProduction, deliveryPerformance, expiryRisk, inventoryByWarehouse, parseRange, productionByDay, productionByProduct,
  salesByDay, temperatureExcursions, yieldByFarm, yieldByShift,
} from "@/server/services/analytics";
import { runChecks } from "@/server/services/checks";
import { qs } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "overview.view" });
  const sp = await searchParams;
  const now = new Date();
  const range = parseRange(sp, ctx.tz, now, "today");
  const single = range.fromKey === range.toKey;
  const chartRange = single ? { fromKey: addDaysKey(range.toKey, -13), toKey: range.toKey, tz: ctx.tz } : range;

  // lazy operational checks (max every 10 minutes)
  const last = await withTenant(ctx, (tx) => tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { lastChecksAt: true } }));
  if (!last?.lastChecksAt || now.getTime() - last.lastChecksAt.getTime() > 10 * 60000) {
    await withTenant(ctx, (tx) => runChecks(tx, ctx)).catch((e) => console.error("checks failed", e));
  }

  const data = await withTenant(ctx, async (tx) => {
    const [k, byDay, byProduct, byFarm, byShift, sales, demand, wh, risk, delivery, temps, alerts] = await Promise.all([
      dashboardKpis(tx, range, now, ctx.settings),
      productionByDay(tx, chartRange),
      productionByProduct(tx, range, 10),
      yieldByFarm(tx, chartRange, 10),
      yieldByShift(tx, chartRange, 14),
      salesByDay(tx, chartRange),
      demandVsProduction(tx, chartRange),
      inventoryByWarehouse(tx, now),
      expiryRisk(tx, now),
      deliveryPerformance(tx, chartRange),
      temperatureExcursions(tx, chartRange),
      tx.notification.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 6 }),
    ]);
    return { k, byDay, byProduct, byFarm, byShift, sales, demand, wh, risk, delivery, temps, alerts };
  });
  const { k } = data;
  const t = ctx.t;
  const rangeLabel = single ? fmtDate(new Date(`${range.fromKey}T12:00:00Z`), "UTC") : `${fmtDate(new Date(`${range.fromKey}T12:00:00Z`), "UTC")} – ${fmtDate(new Date(`${range.toKey}T12:00:00Z`), "UTC")}`;
  const chartLabel = single ? t("Last 14 days") : rangeLabel;
  const cur = ctx.tenant.currency;
  const dateQ = qs(sp, {});
  const retailWh = data.wh.filter((w) => w.type === "RETAIL");
  const whRows = [
    ...data.wh.filter((w) => w.type !== "RETAIL"),
    ...(retailWh.length
      ? [{ id: "retail", name: t("Retail stores ({n})", { n: retailWh.length }), type: "RETAIL", chilled: retailWh.reduce((s, w) => s + w.chilled, 0), frozen: retailWh.reduce((s, w) => s + w.frozen, 0), other: 0, blocked: retailWh.reduce((s, w) => s + w.blocked, 0), value: 0 }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t("Operational overview")}
        description={`${ctx.tenant.name} · ${rangeLabel} · ${t("time zone")} ${ctx.tz}`}
        actions={
          <>
            <RangeFilter />
            <LinkButton href={`/api/export/dashboard${dateQ}`} size="sm">
              <Download className="h-4 w-4" /> CSV
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("Production (saleable)")} value={fmtWeight(k.productionKg)} sub={`${t("Input")} ${fmtWeight(k.inputKg)}`} href={`/app/production${dateQ}`} />
        <Kpi label={t("Birds processed")} value={fmtNum(k.birds)} sub={k.birds ? `${t("avg")} ${(k.inputKg / k.birds).toFixed(2)} kg` : undefined} href={`/app/production${dateQ}`} />
        <Kpi label={t("Production yield")} value={k.yieldInputKg ? fmtPct(k.yieldPct) : "—"} sub={k.pendingInputKg > 1 ? t("{kg} input awaiting output", { kg: fmtWeight(k.pendingInputKg) }) : t("saleable ÷ live input")} href={`/app/production${dateQ}`} tone={k.yieldInputKg && k.yieldPct < 72 ? "warning" : "default"} />
        <Kpi label={t("Production waste")} value={k.yieldInputKg ? fmtPct(k.wastePct) : "—"} sub={fmtWeight(k.wasteKg)} href={`/app/production${dateQ}`} />
        <Kpi label={t("Active orders")} value={fmtNum(k.activeOrders)} sub={t("not yet delivered")} href="/app/orders?status=open" />
        <Kpi label={t("OTIF")} value={k.otifPct === null ? "—" : fmtPct(k.otifPct)} sub={t("{n} delivered orders", { n: k.deliveredOrders })} href={`/app/orders?status=delivered`} tone={k.otifPct !== null && k.otifPct < 90 ? "warning" : "good"} />
        <Kpi label={t("Chilled inventory")} value={fmtWeight(k.chilledKg)} sub={`${t("Frozen")} ${fmtWeight(k.frozenKg)}`} href="/app/inventory?storage=CHILLED" />
        <Kpi label={t("Expiring within 72 h")} value={fmtWeight(k.expiringKg)} sub={t("{n} lots", { n: k.expiringLots })} href="/app/inventory?expiring=72" tone={k.expiringKg > 0 ? "warning" : "default"} />
        <Kpi label={t("Cold-chain alerts")} value={fmtNum(k.coldChainAlerts)} sub={t("excursions in period")} href="/app/logistics/temperature?excursions=1" tone={k.coldChainAlerts > 0 ? "critical" : "good"} />
        <Kpi label={t("Customer returns")} value={fmtWeight(k.returnsKg)} sub={t("{n} returns", { n: k.returnsCount })} href="/app/sales/returns" />
        <Kpi label={t("Sales")} value={fmtMoneyShort(k.sales, cur)} sub={`B2B ${fmtMoneyShort(k.salesB2b, cur)} · ${t("Retail")} ${fmtMoneyShort(k.salesRetail, cur)}`} href="/app/reports?tab=sales" />
        <Kpi label={t("Outstanding receivables")} value={fmtMoneyShort(k.receivables, cur)} sub={t("{n} open invoices", { n: k.receivablesCount })} href="/app/sales/receivables" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("Production by day")} description={`${chartLabel} · kg`} />
          <BarChartView
            data={data.byDay}
            xKey="day"
            stacked
            unit="kg"
            series={[
              { key: "products", label: "Products" },
              { key: "byproducts", label: "By-products" },
              { key: "waste", label: "Waste", color: "#98a2b3" },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("Open alerts")} actions={<Link href="/app/notifications" className="link text-[13px]">{t("All")}</Link>} />
          {data.alerts.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t("No open alerts.")}</p>
          ) : (
            <ul className="space-y-3">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex gap-2.5">
                  <StatusBadge status={a.severity} />
                  <div className="min-w-0">
                    <Link href={a.link ?? "/app/notifications"} className="block truncate text-[13px] font-medium text-ink hover:underline">{t(a.title, notificationParams(a.params))}</Link>
                    <div className="text-[12px] text-ink-3">{fmtDateTime(a.createdAt, ctx.tz)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Production by product")} description={`${rangeLabel} · ${t("top 10")} · kg`} />
          <BarChartView data={data.byProduct} xKey="name" horizontal series={[{ key: "kg", label: "Output" }]} unit="kg" height={300} />
        </Card>
        <Card>
          <CardHeader title={t("Yield by farm")} description={`${chartLabel} · ${t("saleable output ÷ live input")} · %`} />
          <DotPlot data={data.byFarm.map((f) => ({ label: `${f.code} · ${f.name}`, value: f.yieldPct, secondary: f.wastePct }))} secondaryLabel={t("waste")} />
        </Card>
        <Card>
          <CardHeader title={t("Yield by production shift")} description={`${chartLabel} · ${t("closed shifts")} · %`} actions={<Link href="/app/production" className="link text-[13px]">{t("Shifts")}</Link>} />
          <DotPlot data={data.byShift.filter((s) => s.input > 0 && s.status === "CLOSED").map((s) => ({ label: `${s.number} · ${fmtDate(s.date, "UTC")} ${t(s.shiftType.charAt(0) + s.shiftType.slice(1).toLowerCase())}`, value: s.yieldPct, secondary: s.wastePct }))} secondaryLabel={t("waste")} />
        </Card>
        <Card>
          <CardHeader title={t("Waste trend")} description={`${chartLabel} · ${t("waste ÷ live input")} · %`} />
          <LineChartView data={data.byDay} xKey="day" series={[{ key: "wastePct", label: "Waste", color: "#eb6834" }]} unit="%" digits={2} />
        </Card>
        <Card>
          <CardHeader title={t("Sales trend")} description={`${chartLabel} · ${cur}`} />
          <LineChartView data={data.sales} xKey="day" series={[{ key: "b2b", label: "B2B invoiced" }, { key: "retail", label: "Retail" }]} unit={cur} digits={0} />
        </Card>
        <Card>
          <CardHeader title={t("Demand vs actual production")} description={`${chartLabel} · kg · ${t("demand = ordered for delivery + retail sold")}`} actions={<Link href="/app/production/planning" className="link text-[13px]">{t("Planning")}</Link>} />
          <LineChartView data={data.demand} xKey="day" series={[{ key: "demand", label: "Demand" }, { key: "produced", label: "Produced" }, { key: "planned", label: "Planned" }]} unit="kg" />
        </Card>
        <Card>
          <CardHeader title={t("Warehouse inventory")} description={`${t("Current stock, not expired")} · kg`} actions={<Link href="/app/inventory" className="link text-[13px]">{t("Inventory")}</Link>} />
          <BarChartView data={whRows} xKey="name" horizontal stacked series={[{ key: "chilled", label: "Chilled" }, { key: "frozen", label: "Frozen" }, { key: "blocked", label: "Blocked", color: "#d03b3b" }]} unit="kg" height={Math.max(200, whRows.length * 44)} />
        </Card>
        <Card>
          <CardHeader title={t("Expiration risk")} description={`${t("Current stock by remaining shelf life")} · kg`} actions={<Link href="/app/inventory?expiring=72" className="link text-[13px]">{t("Expiring stock")}</Link>} />
          <BarChartView data={data.risk.map((r) => ({ ...r, label: t(r.label) }))} xKey="label" series={[{ key: "kg", label: "Stock" }]} unit="kg" />
        </Card>
        <Card>
          <CardHeader title={t("Delivery performance")} description={`${chartLabel} · %`} actions={<Link href="/app/logistics" className="link text-[13px]">{t("Shipments")}</Link>} />
          <LineChartView data={data.delivery} xKey="day" series={[{ key: "otifPct", label: "OTIF" }, { key: "onTimePct", label: "On time" }, { key: "inFullPct", label: "In full" }]} unit="%" />
        </Card>
        <Card>
          <CardHeader title={t("Temperature excursions")} description={`${chartLabel} · ${t("readings above/below limits")}`} actions={<Link href="/app/logistics/temperature" className="link text-[13px]">{t("Cold chain")}</Link>} />
          <BarChartView data={data.temps} xKey="day" stacked series={[{ key: "chamber", label: "Storage chambers" }, { key: "vehicle", label: "Vehicles" }]} digits={0} />
        </Card>
      </div>
    </>
  );
}
