import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { ExportLinks, Kpi, LinkButton, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, qs, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, RangeFilter, SearchBox, Toolbar } from "@/components/ui/controls";
import { parseRange, rangeBounds } from "@/server/services/analytics";
import { LogisticsTabs } from "./tabs";

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "logistics.view" });
  const sp = await searchParams;
  const range = parseRange(sp, ctx.tz, new Date(), "7d");
  const { from, to } = rangeBounds(range);
  const lp = listParams(sp, { defaultSort: "plannedDeparture", sortable: ["plannedDeparture", "number"] });
  const status = spGet(sp, "status");
  const where: Prisma.ShipmentWhereInput = {
    plannedDeparture: { gte: from, lt: to },
    ...(status ? { status: status as "PLANNED" } : {}),
    ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { vehicle: { plate: { contains: lp.q, mode: "insensitive" } } }, { driver: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, counts, excursions, ready] = await Promise.all([
      tx.shipment.findMany({ where, include: { vehicle: true, driver: true, route: true, stops: true, readings: { orderBy: { recordedAt: "desc" }, take: 1 }, _count: { select: { readings: { where: { isExcursion: true } } } } }, orderBy: { [lp.sort]: lp.dir }, skip: lp.skip, take: lp.take }),
      tx.shipment.count({ where }),
      tx.shipment.groupBy({ by: ["status"], where: { plannedDeparture: { gte: from, lt: to } }, _count: true }),
      tx.temperatureReading.count({ where: { sourceType: "VEHICLE", isExcursion: true, recordedAt: { gte: from, lt: to } } }),
      tx.order.count({ where: { status: "READY_FOR_DISPATCH" } }),
    ]);
    return { rows, total, counts, excursions, ready };
  });
  const t = ctx.t;
  const c = (s: string) => data.counts.find((x) => x.status === s)?._count ?? 0;
  return (
    <>
      <PageHeader
        title={t("Logistics & Fleet")}
        description={t("Plan shipments from ready orders, track departures, deliveries and refrigerated-body temperatures.")}
        actions={
          <>
            <ExportLinks report="shipments" query={qs(sp, { page: null, q: null })} />
            {ctx.can("logistics.operate") && <LinkButton href="/app/logistics/new" variant="primary"><Plus className="h-4 w-4" /> {t("Plan shipment")}</LinkButton>}
          </>
        }
      />
      <LogisticsTabs current="shipments" t={t} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t("Orders ready for dispatch")} value={fmtNum(data.ready)} href="/app/orders?status=READY_FOR_DISPATCH" />
        <Kpi label={t("Planned")} value={fmtNum(c("PLANNED") + c("LOADING"))} />
        <Kpi label={t("In transit")} value={fmtNum(c("IN_TRANSIT"))} />
        <Kpi label={t("Delivered")} value={fmtNum(c("DELIVERED") + c("PARTIALLY_DELIVERED"))} />
        <Kpi label={t("Vehicle temperature excursions")} value={fmtNum(data.excursions)} tone={data.excursions ? "critical" : "good"} href="/app/logistics/temperature?excursions=1" />
      </div>
      <Toolbar><RangeFilter options={["today", "7d", "30d"]} /></Toolbar>
      <Toolbar>
        <SearchBox placeholder="Shipment, vehicle, driver…" />
        <FilterSelect param="status" label="Status" options={["PLANNED", "IN_TRANSIT", "DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED"].map((s) => ({ value: s, label: s.replaceAll("_", " ").toLowerCase() }))} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/logistics"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/logistics/shipments/${r.id}`}
        columns={[
          { key: "n", header: "Shipment", sortKey: "number", render: (r) => r.number },
          { key: "p", header: "Planned departure", sortKey: "plannedDeparture", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.plannedDeparture, ctx.tz)}</span> },
          { key: "v", header: "Vehicle / driver", render: (r) => <>{r.vehicle.plate}<div className="text-[11.5px] text-ink-3">{r.driver.name}</div></> },
          { key: "r", header: "Route", render: (r) => <span className="text-[12.5px]">{r.route?.name ?? "—"}</span> },
          { key: "s", header: "Stops", align: "right", render: (r) => `${r.stops.filter((x) => x.status !== "PENDING").length}/${r.stops.length}` },
          { key: "m", header: "Mode", render: (r) => <Pill tone={r.temperatureMode === "FROZEN" ? "blue" : "green"}>{t(r.temperatureMode === "FROZEN" ? "Frozen" : "Chilled")}</Pill> },
          { key: "temp", header: "Last temp", align: "right", render: (r) => (r.readings[0] ? <span className={r.readings[0].isExcursion ? "font-medium text-red-700" : ""}>{r.readings[0].temperatureC.toFixed(1)} °C</span> : "—") },
          { key: "x", header: "Excursions", align: "right", render: (r) => (r._count.readings ? <Pill tone="red">{r._count.readings}</Pill> : "0") },
          { key: "st", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </>
  );
}
