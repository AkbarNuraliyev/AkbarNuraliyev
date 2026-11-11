import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDay, fmtKg, fmtNum, fmtPct, fmtWeight } from "@/lib/format";
import { localDateKey } from "@/lib/tz";
import { Card, CardHeader, ExportLinks, Kpi, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, FormGrid, NumberInput, SelectInput, SubmitButton, TextInput, TextArea, FormActions } from "@/components/ui/form";
import { RangeFilter, Toolbar } from "@/components/ui/controls";
import { DataTable, qs, type SP } from "@/components/ui/table";
import { BarChartView, LineChartView } from "@/components/charts";
import { dashboardKpis, parseRange, productionByDay, yieldByShift } from "@/server/services/analytics";
import { createShiftAction } from "./actions";
import { ProductionTabs } from "./tabs";

export default async function ProductionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "production.view" });
  const sp = await searchParams;
  const now = new Date();
  const range = parseRange(sp, ctx.tz, now, "7d");
  const data = await withTenant(ctx, async (tx) => {
    const [k, days, shifts, lines] = await Promise.all([
      dashboardKpis(tx, range, now, ctx.settings),
      productionByDay(tx, range),
      yieldByShift(tx, range, 200),
      tx.productionLine.findMany({ where: { isActive: true }, include: { facility: true }, orderBy: { code: "asc" } }),
    ]);
    return { k, days, shifts: shifts.reverse(), lines };
  });
  const t = ctx.t;
  const tol = ctx.settings.massBalanceTolerancePct;
  return (
    <>
      <PageHeader
        title={t("Production / MES")}
        description={t("Disassembly tracking by batch and shift: input live weight, outputs by cut, by-products and waste.")}
        actions={
          <>
            <ExportLinks report="shifts" query={qs(sp, {})} />
            <ExportLinks report="outputs" query={qs(sp, {})} />
            {ctx.can("production.operate") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("Open shift")}</>} title="Open production shift" triggerVariant="primary">
                <ActionForm action={createShiftAction} className="space-y-4">
                  <SelectInput name="lineId" label="Production line" required placeholder="" options={data.lines.map((l) => ({ value: l.id, label: `${l.code} — ${l.name} (${l.facility.name})` }))} defaultValue={data.lines[0]?.id} />
                  <FormGrid>
                    <TextInput name="shiftDate" label="Shift date" type="date" required defaultValue={localDateKey(now, ctx.tz)} />
                    <SelectInput name="shiftType" label="Shift" defaultValue="DAY" translateOptions options={[{ value: "DAY", label: "Day" }, { value: "EVENING", label: "Evening" }, { value: "NIGHT", label: "Night" }]} />
                    <NumberInput name="plannedInputKg" label="Planned input (live kg)" suffix="kg" />
                    <NumberInput name="plannedBirds" label="Planned birds" step={1} />
                  </FormGrid>
                  <TextInput name="supervisorName" label="Shift supervisor" defaultValue={ctx.user.name} />
                  <TextArea name="notes" label="Notes" rows={2} />
                  <FormError />
                  <FormActions><SubmitButton>Open shift</SubmitButton></FormActions>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      <ProductionTabs current="shifts" t={t} />
      <Toolbar>
        <RangeFilter options={["today", "7d", "30d", "90d"]} />
      </Toolbar>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("Live input")} value={fmtWeight(data.k.inputKg)} />
        <Kpi label={t("Birds processed")} value={fmtNum(data.k.birds)} />
        <Kpi label={t("Saleable output")} value={fmtWeight(data.k.productionKg)} />
        <Kpi label={t("Total yield")} value={data.k.yieldInputKg ? fmtPct(data.k.yieldPct, 2) : "—"} sub={t("saleable ÷ input × 100")} />
        <Kpi label={t("Waste")} value={data.k.yieldInputKg ? fmtPct(data.k.wastePct, 2) : "—"} sub={fmtWeight(data.k.wasteKg)} />
        <Kpi label={t("Shifts")} value={fmtNum(data.shifts.length)} sub={t("{n} open", { n: data.shifts.filter((s) => s.status === "OPEN").length })} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Output by day")} description="kg" />
          <BarChartView data={data.days} xKey="day" stacked unit="kg" series={[{ key: "products", label: "Products" }, { key: "byproducts", label: "By-products" }, { key: "waste", label: "Waste", color: "#98a2b3" }]} />
        </Card>
        <Card>
          <CardHeader title={t("Yield and waste by day")} description="%" />
          <LineChartView data={data.days} xKey="day" unit="%" digits={2} series={[{ key: "yieldPct", label: "Total yield" }, { key: "wastePct", label: "Waste" }]} />
        </Card>
      </div>
      <div className="mt-4">
        <DataTable
          t={t}
          sp={sp}
          basePath="/app/production"
          rows={data.shifts}
          rowKey={(r) => r.id}
          rowHref={(r) => `/app/production/shifts/${r.id}`}
          columns={[
            { key: "n", header: "Shift", render: (r) => r.number },
            { key: "d", header: "Date", render: (r) => `${fmtDay(r.date)} · ${t(r.shiftType.charAt(0) + r.shiftType.slice(1).toLowerCase())}` },
            { key: "l", header: "Line", render: (r) => r.line },
            { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "p", header: "Planned input", align: "right", render: (r) => (r.plannedInputKg ? fmtKg(r.plannedInputKg, 0) : "—") },
            { key: "i", header: "Input", align: "right", render: (r) => fmtKg(r.input, 0) },
            { key: "o", header: "Saleable", align: "right", render: (r) => fmtKg(r.saleable, 0) },
            { key: "y", header: "Yield", align: "right", render: (r) => (r.input ? fmtPct(r.yieldPct, 2) : "—") },
            { key: "w", header: "Waste", align: "right", render: (r) => (r.input ? fmtPct(r.wastePct, 2) : "—") },
            {
              key: "u",
              header: "Unexplained",
              align: "right",
              render: (r) => (r.input && r.saleable ? Math.abs(r.unexplainedPct) > tol ? <Pill tone="red">{fmtPct(r.unexplainedPct, 2)}</Pill> : fmtPct(r.unexplainedPct, 2) : "—"),
            },
          ]}
        />
      </div>
    </>
  );
}
