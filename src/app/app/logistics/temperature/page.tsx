import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtTemp, fmtTime } from "@/lib/format";
import { toLocalInput } from "@/lib/tz";
import { tempLimits } from "@/lib/settings";
import { Alert, Card, CardHeader, DataSourceBadge, ExportLinks, PageHeader, Pill, cx } from "@/components/ui/basic";
import { DataTable, listParams, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, Toolbar } from "@/components/ui/controls";
import { LineChartView } from "@/components/charts";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { recordTemperatureAction } from "../actions";
import { LogisticsTabs } from "../tabs";

export default async function TemperaturePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "logistics.view" });
  const sp = await searchParams;
  const chamberId = spGet(sp, "chamber");
  const excursionsOnly = spGet(sp, "excursions") === "1";
  const source = spGet(sp, "source");
  const lp = listParams(sp, { defaultSort: "recordedAt", sortable: ["recordedAt"], pageSize: 30 });
  const since = new Date(Date.now() - 3 * 86400000);
  const where: Prisma.TemperatureReadingWhereInput = {
    ...(chamberId ? { chamberId } : {}),
    ...(excursionsOnly ? { isExcursion: true } : {}),
    ...(source ? { sourceType: source as "CHAMBER" } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [chambers, latest, rows, total, series] = await Promise.all([
      tx.storageChamber.findMany({ where: { isActive: true }, include: { warehouse: true }, orderBy: [{ warehouse: { type: "asc" } }, { code: "asc" }] }),
      tx.$queryRaw<{ chamberId: string; temperatureC: number; isExcursion: boolean; recordedAt: Date; dataSource: string }[]>`
        SELECT DISTINCT ON ("chamberId") "chamberId", "temperatureC", "isExcursion", "recordedAt", "dataSource"::text FROM temperature_readings WHERE "chamberId" IS NOT NULL ORDER BY "chamberId", "recordedAt" DESC`,
      tx.temperatureReading.findMany({ where, include: { chamber: { include: { warehouse: true } }, vehicle: true, shipment: true }, orderBy: { recordedAt: "desc" }, skip: lp.skip, take: lp.take }),
      tx.temperatureReading.count({ where }),
      chamberId ? tx.temperatureReading.findMany({ where: { chamberId, recordedAt: { gte: since } }, orderBy: { recordedAt: "asc" } }) : Promise.resolve([]),
    ]);
    return { chambers, latest, rows, total, series };
  });
  const t = ctx.t;
  const selected = data.chambers.find((c) => c.id === chamberId);
  const anyDemo = data.latest.some((l) => l.dataSource === "DEMO");
  return (
    <>
      <PageHeader
        title={t("Logistics & Fleet")}
        description={t("Storage chamber and vehicle temperature monitoring with excursion alerts. Limits: chilled ≤ +{c} °C, frozen ≤ {f} °C (configurable).", { c: ctx.settings.chilledMaxTempC, f: ctx.settings.frozenMaxTempC })}
        actions={<ExportLinks report="temperature" />}
      />
      <LogisticsTabs current="temperature" t={t} />
      {anyDemo && <Alert tone="info" className="mb-4">{t("Readings marked “Demo data” are simulated for the demonstration workspace. No temperature sensors or telematics devices are connected; live device readings would be marked “Device”.")}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.chambers.map((c) => {
          const l = data.latest.find((x) => x.chamberId === c.id);
          const lim = tempLimits(ctx.settings, c.type);
          const stale = l && Date.now() - new Date(l.recordedAt).getTime() > 12 * 3600000;
          return (
            <Link key={c.id} href={`/app/logistics/temperature?chamber=${c.id}`} className={cx("card block p-3 hover:border-navy-200", c.id === chamberId && "border-navy-600", l?.isExcursion && "border-red-300 bg-red-50/40")}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{c.name}</span>
                <Pill tone={c.type === "FROZEN" ? "blue" : "green"}>{t(c.type.charAt(0) + c.type.slice(1).toLowerCase())}</Pill>
              </div>
              <div className="truncate text-[11.5px] text-ink-3">{c.warehouse.name}</div>
              <div className={cx("mt-1.5 text-xl font-semibold tabular", l?.isExcursion ? "text-red-700" : "text-ink")}>{l ? fmtTemp(l.temperatureC) : "—"}</div>
              <div className="text-[11.5px] text-ink-3">
                {t("limit")} {c.minTempC ?? lim.min ?? "—"} … {c.maxTempC ?? lim.max} °C · {l ? fmtDateTime(l.recordedAt, ctx.tz) : t("no readings")} {stale && <span className="text-amber-700">· {t("stale")}</span>}
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {selected && (
            <Card>
              <CardHeader title={`${selected.warehouse.name} / ${selected.name}`} description={t("Last 72 hours")} />
              <LineChartView data={data.series.map((r) => ({ time: `${fmtDateTime(r.recordedAt, ctx.tz).slice(0, 5)} ${fmtTime(r.recordedAt, ctx.tz)}`, temp: r.temperatureC }))} xKey="time" series={[{ key: "temp", label: "Temperature" }]} unit="°C" referenceY={{ value: selected.maxTempC ?? tempLimits(ctx.settings, selected.type).max, label: "max" }} height={240} />
            </Card>
          )}
          <Toolbar>
            <FilterSelect param="source" label="Source" options={[{ value: "CHAMBER", label: "Storage chambers" }, { value: "VEHICLE", label: "Vehicles" }]} />
            <FilterSelect param="excursions" label="Readings" options={[{ value: "1", label: "Excursions only" }]} />
          </Toolbar>
          <DataTable
            t={t}
            sp={sp}
            basePath="/app/logistics/temperature"
            params={lp}
            total={data.total}
            rows={data.rows}
            rowKey={(r) => r.id}
            dense
            columns={[
              { key: "at", header: "Time", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.recordedAt, ctx.tz)}</span> },
              { key: "src", header: "Location", render: (r) => (r.chamber ? `${r.chamber.warehouse.name} / ${r.chamber.name}` : <>{r.vehicle?.plate} {r.shipment && <Link href={`/app/logistics/shipments/${r.shipmentId}`} className="link">{r.shipment.number}</Link>}</>) },
              { key: "v", header: "Temperature", align: "right", render: (r) => <span className={r.isExcursion ? "font-semibold text-red-700" : ""}>{fmtTemp(r.temperatureC)}</span> },
              { key: "lim", header: "Limits", render: (r) => <span className="text-[12px] text-ink-3">{r.limitMinC ?? "—"} … {r.limitMaxC ?? "—"} °C</span> },
              { key: "ds", header: "Data", render: (r) => <DataSourceBadge source={r.dataSource} t={t} /> },
              { key: "st", header: "Status", render: (r) => (r.isExcursion ? <Pill tone="red">{t("Excursion")}</Pill> : <Pill tone="green">OK</Pill>) },
            ]}
          />
        </div>
        {ctx.can("logistics.operate") && (
          <Card className="self-start">
            <CardHeader title={t("Record chamber reading (manual)")} description={t("Manual thermometer checks are stored with source “Manual”.")} />
            <ActionForm action={recordTemperatureAction} className="space-y-3" resetOnSuccess>
              <Hidden name="sourceType" value="CHAMBER" />
              <SelectInput name="chamberId" label="Chamber" required placeholder="" defaultValue={chamberId} options={data.chambers.map((c) => ({ value: c.id, label: `${c.warehouse.name} / ${c.name}` }))} />
              <NumberInput name="temperatureC" label="Temperature" required suffix="°C" />
              <TextInput name="recordedAt" label="Time" type="datetime-local" required defaultValue={toLocalInput(new Date(), ctx.tz)} />
              <FormError />
              <SubmitButton className="w-full">Save reading</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
