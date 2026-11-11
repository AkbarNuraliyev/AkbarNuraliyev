import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, DescriptionList, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { DocumentsPanel } from "@/components/app/documents";

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "quality.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const r = await tx.qualityRecord.findUnique({ where: { id }, include: { checklist: true } });
    if (!r) return null;
    const [batch, ncs] = await Promise.all([
      r.batchId ? tx.productionBatch.findUnique({ where: { id: r.batchId } }) : null,
      tx.nonconformity.findMany({ where: { qualityRecordId: id } }),
    ]);
    return { r, batch, ncs };
  });
  if (!data) notFound();
  const { r } = data;
  const t = ctx.t;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t("Quality Control"), href: "/app/quality" }, { label: r.number }]} title={`${r.number} · ${r.checklist.name}`} description={`${r.area} · ${fmtDateTime(r.performedAt, ctx.tz)}`} actions={<StatusBadge status={r.result} />} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Responses")} />
            <SimpleTable head={[t("Check"), t("Value"), t("Result")]}>
              {(r.responses as { id: string; label: string; value: unknown; ok: boolean; critical: boolean }[]).map((x) => (
                <tr key={x.id}>
                  <td className="td">{t(x.label)} {x.critical && <span className="text-[11px] font-semibold text-red-600">CCP</span>}</td>
                  <td className="td">{typeof x.value === "boolean" ? (x.value ? t("Yes") : t("No")) : String(x.value ?? "—")}</td>
                  <td className="td"><StatusBadge status={x.ok ? "PASS" : "FAIL"} /></td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <DocumentsPanel ctx={ctx} entityType="quality_record" entityId={r.id} canUpload={ctx.can("quality.operate")} title="Photo attachments" defaultType="PHOTO" />
        </div>
        <Card>
          <CardHeader title={t("Record")} />
          <DescriptionList
            cols={1}
            items={[
              { label: t("Responsible"), value: r.performedByName },
              { label: t("Performed"), value: fmtDateTime(r.performedAt, ctx.tz) },
              { label: t("Recorded"), value: fmtDateTime(r.createdAt, ctx.tz) },
              { label: t("Batch"), value: data.batch ? <Link href={`/app/traceability/${data.batch.id}`} className="link font-mono text-[12px]">{data.batch.code}</Link> : "—" },
              { label: t("Notes"), value: r.notes },
              { label: t("Non-conformities"), value: data.ncs.length ? data.ncs.map((n) => <Link key={n.id} href={`/app/quality/nonconformities/${n.id}`} className="link mr-2">{n.number}</Link>) : "—" },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
