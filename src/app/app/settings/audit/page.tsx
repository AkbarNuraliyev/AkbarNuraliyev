import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { ExportLinks, PageHeader, Pill } from "@/components/ui/basic";
import { DataTable, listParams, qs, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, RangeFilter, SearchBox, Toolbar } from "@/components/ui/controls";
import { parseRange, rangeBounds } from "@/server/services/analytics";
import { SettingsTabs } from "../tabs";

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "settings.manage" });
  const sp = await searchParams;
  const range = parseRange(sp, ctx.tz, new Date(), "7d");
  const { from, to } = rangeBounds(range);
  const lp = listParams(sp, { defaultSort: "createdAt", sortable: ["createdAt"], pageSize: 50 });
  const entity = spGet(sp, "entity");
  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(entity ? { entityType: entity } : {}),
    ...(lp.q ? { OR: [{ action: { contains: lp.q, mode: "insensitive" } }, { summary: { contains: lp.q, mode: "insensitive" } }, { userEmail: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, entities] = await Promise.all([
      tx.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
      tx.auditLog.count({ where }),
      tx.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    ]);
    return { rows, total, entities };
  });
  const t = ctx.t;
  return (
    <>
      <PageHeader title={t("Settings & Subscription")} description={t("Immutable audit trail of critical operations: batches, inventory, production, orders, financial records, users and settings.")} actions={<ExportLinks report="audit" query={qs(sp, { page: null })} />} />
      <SettingsTabs current="audit" t={t} />
      <Toolbar><RangeFilter options={["today", "7d", "30d", "90d"]} /></Toolbar>
      <Toolbar>
        <SearchBox placeholder="Action, summary, user…" />
        <FilterSelect param="entity" label="Entity" translate={false} options={data.entities.map((e) => ({ value: e.entityType, label: e.entityType }))} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/settings/audit"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        dense
        columns={[
          { key: "at", header: "Time", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt, ctx.tz)}</span> },
          { key: "u", header: "User", render: (r) => r.userEmail ?? t("System") },
          { key: "a", header: "Action", render: (r) => <Pill>{r.action}</Pill> },
          { key: "e", header: "Entity", render: (r) => <span className="text-[12.5px] text-ink-3">{r.entityType}</span> },
          { key: "s", header: "Summary", render: (r) => <span className="text-[12.5px]">{r.summary}</span> },
          {
            key: "c",
            header: "Changes",
            render: (r) =>
              r.changes && typeof r.changes === "object" && Object.keys(r.changes).length ? (
                <details className="text-[11.5px]">
                  <summary className="cursor-pointer text-navy-700">{Object.keys(r.changes).length} {t("field(s)")}</summary>
                  <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify(r.changes, null, 1)}</pre>
                </details>
              ) : null,
          },
        ]}
      />
    </>
  );
}
