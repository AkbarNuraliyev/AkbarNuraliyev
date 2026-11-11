import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtKg, fmtNum } from "@/lib/format";
import { addDaysKey, localDateKey } from "@/lib/tz";
import { Alert, Card, CardHeader, ExportLinks, Kpi, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { ActionForm, FormError, Hidden, SubmitButton } from "@/components/ui/form";
import { LineChartView } from "@/components/charts";
import { spGet, type SP } from "@/components/ui/table";
import { forecastForDate, planVsActual } from "@/server/services/forecast";
import { savePlanAction } from "../actions";
import { ProductionTabs } from "../tabs";
import { DatePicker } from "./date-picker";

export default async function PlanningPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "production.view", feature: "forecasting" });
  const sp = await searchParams;
  const today = localDateKey(new Date(), ctx.tz);
  const d = spGet(sp, "date");
  const target = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today ? d : addDaysKey(today, 1);
  const { fc, pva } = await withTenant(ctx, async (tx) => ({
    fc: await forecastForDate(tx, ctx, target),
    pva: await planVsActual(tx, ctx, addDaysKey(today, -14), today),
  }));
  const t = ctx.t;
  const canEdit = ctx.can("production.manage");
  const approved = fc.lines.some((l) => l.planStatus === "APPROVED");
  return (
    <>
      <PageHeader
        title={t("Production / MES")}
        description={t("Next-day production recommendation from historical demand, booked orders, stock and shelf life.")}
        actions={<ExportLinks report="plans" />}
      />
      <ProductionTabs current="planning" t={t} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DatePicker value={target} min={today} />
        {approved ? <StatusBadge status="APPROVED" /> : <StatusBadge status="DRAFT" label="Not approved" />}
        {fc.holiday && <Pill tone="amber">{t("Holiday")}: {fc.holiday.name} ×{fc.holiday.factor}</Pill>}
      </div>
      <Alert tone="info" title={t("Forecast method (transparent statistics)")} className="mb-4">
        {t(fc.method)} {t("History window")}: {fc.window.from} … {fc.window.to}.
      </Alert>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("Forecast demand")} value={fmtKg(fc.totals.forecastKg, 0)} />
        <Kpi label={t("Booked orders")} value={fmtKg(fc.totals.bookedKg, 0)} />
        <Kpi label={t("Usable stock")} value={fmtKg(fc.totals.usableKg, 0)} sub={t("valid through target day")} />
        <Kpi label={t("Recommended production")} value={fmtKg(fc.totals.recommendedKg, 0)} tone="good" />
        <Kpi label={t("Expected shortage")} value={fmtKg(fc.totals.shortageKg, 0)} tone={fc.totals.shortageKg > 0 ? "critical" : "default"} sub={t("with planned quantities")} />
        <Kpi label={t("Potential chilled write-off")} value={fmtKg(fc.totals.atRiskKg, 0)} tone={fc.totals.atRiskKg > 0 ? "warning" : "default"} sub={t("free stock expiring before target day ends")} />
      </div>
      {fc.liveWeight && (
        <Card className="mt-4">
          <div className="text-sm text-ink-2">
            {t("Live weight required to cover the binding product")} <b>{fc.liveWeight.bindingProduct}</b>: <b className="tabular">{fmtKg(fc.liveWeight.kg, 0)}</b>
            {fc.liveWeight.birds ? <> ≈ <b className="tabular">{fmtNum(fc.liveWeight.birds)}</b> {t("birds")} ({t("avg")} {fc.liveWeight.avgBirdKg} kg)</> : null}
            . {t("Disassembly produces all cuts together, so the product with the highest requirement ÷ yield determines the live input.")}
          </div>
        </Card>
      )}
      <ActionForm action={savePlanAction} className="mt-4">
        <Hidden name="date" value={target} />
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-slate-50/70">
                <tr>
                  {["Product", "Avg/day (14d)", "DoW index", "Statistical", "Booked", "Forecast", "Usable stock", "At risk", "Safety", "Recommended", "Planned (editable)", "Shortage", "Surplus", "Live kg needed"].map((h) => (
                    <th key={h} className="th">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {fc.lines.map((l) => (
                  <tr key={l.productId} className="align-top">
                    <td className="td min-w-[220px]">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-[11.5px] text-ink-3">{l.sku} · {l.storageType === "FROZEN" ? t("Frozen") : t("Chilled")} · {l.shelfLifeHours} h</div>
                      <details className="mt-1 text-[11.5px] text-ink-3">
                        <summary className="cursor-pointer text-navy-700">{t("Assumptions")}</summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">{l.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                      </details>
                    </td>
                    <td className="td tabular">{l.history.recentAvg}</td>
                    <td className="td tabular">{l.dowIndex}</td>
                    <td className="td tabular">{l.b2bStat + l.retailStat > 0 ? (l.b2bStat + l.retailStat).toFixed(1) : "0"}</td>
                    <td className="td tabular">{l.bookedOrdersKg}</td>
                    <td className="td tabular font-medium">{l.forecastKg}</td>
                    <td className="td tabular">{l.usableStockKg}</td>
                    <td className="td tabular">{l.atRiskKg > 0 ? <span className="text-amber-700">{l.atRiskKg}</span> : 0}</td>
                    <td className="td tabular">{l.safetyKg}</td>
                    <td className="td tabular font-semibold text-brand-700">{l.recommendedKg}</td>
                    <td className="td">
                      <input name={`adj_${l.productId}`} type="number" step="any" min={0} defaultValue={l.adjustedKg ?? l.recommendedKg} disabled={!canEdit} className="input h-8 w-24 py-1 text-right tabular" />
                    </td>
                    <td className="td tabular">{l.expectedShortageKg > 0 ? <span className="font-medium text-red-700">{l.expectedShortageKg}</span> : 0}</td>
                    <td className="td tabular">{l.expectedSurplusKg > 0 ? <span className={l.storageType === "CHILLED" ? "text-amber-700" : ""}>{l.expectedSurplusKg}</span> : 0}</td>
                    <td className="td tabular text-ink-3">{l.liveWeightRequiredKg ?? "—"}</td>
                  </tr>
                ))}
                {fc.lines.length === 0 && (
                  <tr><td colSpan={14} className="td text-center text-ink-3">{t("Not enough order or sales history to forecast yet.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {canEdit && fc.lines.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <FormError />
            <SubmitButton variant="secondary" name="intent" value="save">Save draft</SubmitButton>
            <SubmitButton name="intent" value="approve">Approve plan</SubmitButton>
          </div>
        )}
      </ActionForm>
      <Card className="mt-4">
        <CardHeader title={t("Planned vs actual production")} description={t("Approved plans for the last 14 days vs. recorded output, kg")} />
        <LineChartView data={pva} xKey="day" unit="kg" series={[{ key: "forecast", label: "Forecast" }, { key: "planned", label: "Planned" }, { key: "actual", label: "Actual" }]} />
      </Card>
    </>
  );
}
