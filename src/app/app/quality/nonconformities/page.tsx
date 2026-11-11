import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ExportLinks, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, Toolbar } from "@/components/ui/controls";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { createNcAction } from "../actions";
import { QualityTabs } from "../tabs";

const SOURCES = [
  { value: "QC_INSPECTION", label: "QC inspection" },
  { value: "CUSTOMER_COMPLAINT", label: "Customer complaint" },
  { value: "AUDIT", label: "Audit" },
  { value: "TEMPERATURE", label: "Temperature" },
  { value: "PRODUCTION", label: "Production" },
  { value: "SUPPLIER", label: "Supplier" },
];

export default async function NcListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "quality.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "createdAt", sortable: ["createdAt"] });
  const status = spGet(sp, "status") ?? "open";
  const where: Prisma.NonconformityWhereInput = {
    ...(status === "open" ? { status: { not: "CLOSED" } } : status !== "all" ? { status: status as "CLOSED" } : {}),
    ...(spGet(sp, "severity") ? { severity: spGet(sp, "severity") as "MAJOR" } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.nonconformity.findMany({ where, include: { batch: true, actions: true }, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
      tx.nonconformity.count({ where }),
    ]);
    return { rows, total };
  });
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Quality Control")}
        description={t("Non-conformity reports with root cause, corrective and preventive actions (CAPA), responsibility and due dates.")}
        actions={
          <>
            <ExportLinks report="nonconformities" />
            {ctx.can("quality.operate") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("Non-conformity")}</>} title="Open non-conformity" size="lg" triggerVariant="primary">
                <ActionForm action={createNcAction} className="space-y-3">
                  <TextInput name="title" label="Title" required />
                  <TextArea name="description" label="Description" required />
                  <div className="grid grid-cols-2 gap-3">
                    <SelectInput name="severity" label="Severity" defaultValue="MAJOR" translateOptions options={[{ value: "MINOR", label: "Minor" }, { value: "MAJOR", label: "Major" }, { value: "CRITICAL", label: "Critical" }]} />
                    <SelectInput name="source" label="Source" defaultValue="QC_INSPECTION" options={SOURCES} translateOptions />
                    <TextInput name="batchCode" label="Batch ID (optional)" />
                    <TextInput name="responsibleName" label="Responsible" />
                    <TextInput name="dueDate" label="Due date" type="date" />
                  </div>
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Open</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      <QualityTabs current="nc" t={t} />
      <Toolbar>
        <FilterSelect param="status" label="Status" allLabel="Open" options={[{ value: "CLOSED", label: "Closed" }, { value: "all", label: "All" }]} />
        <FilterSelect param="severity" label="Severity" options={[{ value: "MINOR", label: "Minor" }, { value: "MAJOR", label: "Major" }, { value: "CRITICAL", label: "Critical" }]} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/quality/nonconformities"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/quality/nonconformities/${r.id}`}
        columns={[
          { key: "n", header: "NC", render: (r) => r.number },
          { key: "at", header: "Opened", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt, ctx.tz)}</span> },
          { key: "t", header: "Title", render: (r) => <span className="font-medium">{r.title}</span> },
          { key: "sv", header: "Severity", render: (r) => <StatusBadge status={r.severity} /> },
          { key: "src", header: "Source", render: (r) => t(SOURCES.find((s) => s.value === r.source)?.label ?? r.source) },
          { key: "resp", header: "Responsible", render: (r) => r.responsibleName ?? "—" },
          { key: "due", header: "Due", render: (r) => (r.dueDate ? <span className={r.dueDate < new Date() && r.status !== "CLOSED" ? "text-red-700" : ""}>{fmtDate(r.dueDate, ctx.tz)}</span> : "—") },
          { key: "capa", header: "CAPA", align: "right", render: (r) => `${r.actions.filter((a) => a.status === "DONE").length}/${r.actions.length}` },
          { key: "st", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </>
  );
}
