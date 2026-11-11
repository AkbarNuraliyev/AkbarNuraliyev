import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtPct, pct } from "@/lib/format";
import { Alert, ExportLinks, Kpi, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, qs, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, RangeFilter, Toolbar } from "@/components/ui/controls";
import { Modal } from "@/components/ui/dialog";
import { parseRange, rangeBounds } from "@/server/services/analytics";
import { QualityTabs } from "./tabs";

export default async function QualityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "quality.view" });
  const sp = await searchParams;
  const range = parseRange(sp, ctx.tz, new Date(), "7d");
  const { from, to } = rangeBounds(range);
  const lp = listParams(sp, { defaultSort: "performedAt", sortable: ["performedAt"] });
  const result = spGet(sp, "result");
  const type = spGet(sp, "type");
  const where: Prisma.QualityRecordWhereInput = {
    performedAt: { gte: from, lt: to },
    ...(result ? { result: result as "PASS" } : {}),
    ...(type ? { checklist: { type: type as "HACCP" } } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, agg, openNc, overdueCapa, checklists] = await Promise.all([
      tx.qualityRecord.findMany({ where, include: { checklist: true }, orderBy: { performedAt: "desc" }, skip: lp.skip, take: lp.take }),
      tx.qualityRecord.count({ where }),
      tx.qualityRecord.groupBy({ by: ["result"], where: { performedAt: { gte: from, lt: to } }, _count: true }),
      tx.nonconformity.count({ where: { status: { not: "CLOSED" } } }),
      tx.capaAction.count({ where: { status: "OPEN", dueDate: { lt: new Date() } } }),
      tx.qualityChecklist.findMany({ where: { isActive: true }, orderBy: { type: "asc" } }),
    ]);
    return { rows, total, agg, openNc, overdueCapa, checklists };
  });
  const t = ctx.t;
  const pass = data.agg.find((a) => a.result === "PASS")?._count ?? 0;
  const fail = data.agg.find((a) => a.result === "FAIL")?._count ?? 0;
  return (
    <>
      <PageHeader
        title={t("Quality Control")}
        description={t("Digital HACCP and food-safety records: inspections, CCP monitoring, sanitation, non-conformities and corrective actions. Supports FSSC 22000 documentation; the software itself does not grant certification.")}
        actions={
          <>
            <ExportLinks report="quality" query={qs(sp, { page: null })} />
            {ctx.can("quality.operate") && (
              <Modal trigger={t("New inspection")} title="Choose checklist" triggerVariant="primary">
                <ul className="divide-y divide-line">
                  {data.checklists.map((c) => (
                    <li key={c.id}>
                      <Link href={`/app/quality/records/new?checklist=${c.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-navy-700">
                        <span className="text-sm font-medium">{c.name}</span>
                        <Pill>{c.type}</Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Modal>
            )}
          </>
        }
      />
      <QualityTabs current="records" t={t} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={t("Inspections")} value={String(pass + fail)} />
        <Kpi label={t("Pass rate")} value={pass + fail ? fmtPct(pct(pass, pass + fail)) : "—"} tone={fail ? "warning" : "good"} />
        <Kpi label={t("Open non-conformities")} value={String(data.openNc)} href="/app/quality/nonconformities" tone={data.openNc ? "warning" : "good"} />
        <Kpi label={t("Overdue CAPA")} value={String(data.overdueCapa)} tone={data.overdueCapa ? "critical" : "good"} href="/app/quality/nonconformities" />
      </div>
      {fail > 0 && <Alert tone="warning" className="mb-4">{t("Failed inspections automatically open a non-conformity for investigation.")}</Alert>}
      <Toolbar><RangeFilter options={["today", "7d", "30d"]} /></Toolbar>
      <Toolbar>
        <FilterSelect param="result" label="Result" options={[{ value: "PASS", label: "Pass" }, { value: "FAIL", label: "Fail" }]} />
        <FilterSelect param="type" label="Type" options={["HACCP", "SANITATION", "RECEIVING", "PRODUCTION", "TEMPERATURE", "GENERAL"].map((x) => ({ value: x, label: x }))} translate={false} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/quality"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/quality/records/${r.id}`}
        columns={[
          { key: "n", header: "Record", render: (r) => r.number },
          { key: "at", header: "Performed", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.performedAt, ctx.tz)}</span> },
          { key: "c", header: "Checklist", render: (r) => <>{r.checklist.name}<div className="text-[11.5px] text-ink-3">{r.checklist.type}</div></> },
          { key: "a", header: "Area", render: (r) => r.area },
          { key: "by", header: "Responsible", render: (r) => r.performedByName ?? "—" },
          { key: "r", header: "Result", render: (r) => <StatusBadge status={r.result} /> },
        ]}
      />
    </>
  );
}
