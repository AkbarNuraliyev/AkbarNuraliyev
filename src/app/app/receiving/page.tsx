import Link from "@/components/ui/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtNum, fmtPct, fmtWeight, pct } from "@/lib/format";
import { ExportLinks, Kpi, LinkButton, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, qs, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, RangeFilter, SearchBox, Toolbar } from "@/components/ui/controls";
import { parseRange, rangeBounds } from "@/server/services/analytics";

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "receiving.view" });
  const sp = await searchParams;
  const range = parseRange(sp, ctx.tz, new Date(), "7d");
  const { from, to } = rangeBounds(range);
  const lp = listParams(sp, { defaultSort: "receivedAt", sortable: ["receivedAt", "number", "netWeightKg", "birdsReceived", "status"] });
  const status = spGet(sp, "status");
  const supplier = spGet(sp, "supplier");
  const where: Prisma.RawMaterialReceiptWhereInput = {
    receivedAt: { gte: from, lt: to },
    ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { batch: { code: { contains: lp.q, mode: "insensitive" } } }, { vehiclePlate: { contains: lp.q, mode: "insensitive" } }, { farm: { code: { contains: lp.q, mode: "insensitive" } } }] } : {}),
    ...(status ? { status: status as "ACCEPTED" } : {}),
    ...(supplier ? { supplierId: supplier } : {}),
  };
  const [rows, total, agg, suppliers] = await withTenant(ctx, (tx) =>
    Promise.all([
      tx.rawMaterialReceipt.findMany({ where, include: { supplier: true, farm: true, batch: true }, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take }),
      tx.rawMaterialReceipt.count({ where }),
      tx.rawMaterialReceipt.groupBy({ by: ["status"], where, _sum: { birdsReceived: true, birdsAccepted: true, netWeightKg: true, acceptedWeightKg: true }, _count: true }),
      tx.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]),
  );
  const t = ctx.t;
  const sum = (k: "birdsReceived" | "birdsAccepted" | "netWeightKg" | "acceptedWeightKg") => agg.reduce((s, a) => s + (a._sum[k] ?? 0), 0);
  const count = agg.reduce((s, a) => s + a._count, 0);
  const notAccepted = agg.filter((a) => a.status !== "ACCEPTED").reduce((s, a) => s + a._count, 0);
  return (
    <>
      <PageHeader
        title={t("Raw Material Receiving")}
        description={t("Live bird deliveries: weighing, inspection, acceptance decision and batch creation.")}
        actions={
          <>
            <ExportLinks report="receipts" query={qs(sp, { page: null, q: null, sort: null, dir: null })} />
            {ctx.can("receiving.operate") && (
              <LinkButton href="/app/receiving/new" variant="primary">
                <Plus className="h-4 w-4" /> {t("Receive delivery")}
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t("Deliveries")} value={fmtNum(count)} sub={t("{n} not fully accepted", { n: notAccepted })} />
        <Kpi label={t("Birds received")} value={fmtNum(sum("birdsReceived"))} />
        <Kpi label={t("Acceptance rate")} value={fmtPct(pct(sum("birdsAccepted"), sum("birdsReceived")), 2)} />
        <Kpi label={t("Net live weight")} value={fmtWeight(sum("netWeightKg"))} />
        <Kpi label={t("Accepted weight")} value={fmtWeight(sum("acceptedWeightKg"))} />
      </div>
      <Toolbar>
        <RangeFilter options={["today", "7d", "30d", "90d"]} />
      </Toolbar>
      <Toolbar>
        <SearchBox placeholder="Receipt, batch ID, farm, vehicle…" />
        <FilterSelect param="status" label="Status" options={[{ value: "ACCEPTED", label: "Accepted" }, { value: "PARTIAL", label: "Partial" }, { value: "REJECTED", label: "Rejected" }]} />
        <FilterSelect param="supplier" label="Supplier" translate={false} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/receiving"
        params={lp}
        total={total}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/receiving/${r.id}`}
        columns={[
          { key: "number", header: "Receipt", sortKey: "number", render: (r) => r.number },
          { key: "batch", header: "Batch ID", render: (r) => (r.batch ? <Link href={`/app/traceability/${r.batch.id}`} className="font-mono text-[12.5px] text-navy-700 hover:underline">{r.batch.code}</Link> : "—") },
          { key: "at", header: "Received", sortKey: "receivedAt", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.receivedAt, ctx.tz)}</span> },
          { key: "supplier", header: "Supplier / farm", render: (r) => <>{r.supplier.name}<div className="text-[12px] text-ink-3">{r.farm.code} · {r.farm.name}</div></> },
          { key: "birds", header: "Birds", sortKey: "birdsReceived", align: "right", render: (r) => <>{fmtNum(r.birdsAccepted)}<div className="text-[12px] text-ink-3">{t("of")} {fmtNum(r.birdsReceived)}</div></> },
          { key: "net", header: "Net kg", sortKey: "netWeightKg", align: "right", render: (r) => fmtKg(r.netWeightKg, 0) },
          { key: "avg", header: "Avg kg", align: "right", render: (r) => r.avgBirdWeightKg.toFixed(3) },
          { key: "source", header: "Weighing", render: (r) => <span className="text-[12px] text-ink-3">{t(r.weighingSource === "SCALE" ? "Scale" : "Manual")}</span> },
          { key: "status", header: "Decision", sortKey: "status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </>
  );
}
