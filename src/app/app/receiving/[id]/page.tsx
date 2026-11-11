import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, Route } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtMoney, fmtNum, fmtPct, fmtTemp, num, pct } from "@/lib/format";
import { Card, CardHeader, DescriptionList, Kpi, LinkButton, PageHeader, Alert } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { DocumentsPanel } from "@/components/app/documents";
import { batchScanUrl, qrSvg } from "@/server/codes";

export default async function ReceiptDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "receiving.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const r = await tx.rawMaterialReceipt.findUnique({ where: { id }, include: { supplier: true, farm: true, facility: true, batch: true } });
    if (!r) return null;
    const qc = await tx.qualityRecord.findMany({ where: { entityType: "raw_material_receipt", entityId: id }, include: { checklist: true } });
    const users = await tx.membership.findMany({ where: { userId: { in: [r.createdById, r.inspectorId].filter(Boolean) as string[] } }, include: { user: true } });
    return { r, qc, users };
  });
  if (!data) notFound();
  const { r, qc } = data;
  const t = ctx.t;
  const createdBy = data.users.find((m) => m.userId === r.createdById)?.user.name ?? "—";
  const qr = r.batch ? await qrSvg(batchScanUrl(r.batch.code), 180) : null;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Raw Material Receiving"), href: "/app/receiving" }, { label: r.number }]}
        title={`${t("Delivery")} ${r.number}`}
        description={`${r.supplier.name} · ${r.farm.code} ${r.farm.name} · ${fmtDateTime(r.receivedAt, ctx.tz)}`}
        actions={
          r.batch && (
            <>
              <LinkButton href={`/print/receipt/${r.id}`} target="_blank">
                <Printer className="h-4 w-4" /> {t("Print batch label")}
              </LinkButton>
              <LinkButton href={`/app/traceability/${r.batch.id}`} variant="primary">
                <Route className="h-4 w-4" /> {t("Trace batch")}
              </LinkButton>
            </>
          )
        }
      />
      {r.status !== "ACCEPTED" && (
        <Alert tone={r.status === "REJECTED" ? "critical" : "warning"} title={t(r.status === "REJECTED" ? "Delivery rejected" : "Delivery partially accepted")} className="mb-4">
          {r.rejectionReason}
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={t("Birds accepted")} value={fmtNum(r.birdsAccepted)} sub={`${t("of")} ${fmtNum(r.birdsReceived)} · DOA ${r.birdsDeadOnArrival}`} />
            <Kpi label={t("Net live weight")} value={fmtKg(r.netWeightKg, 1)} sub={`${t("Gross")} ${fmtKg(r.grossWeightKg, 0)} − ${t("tare")} ${fmtKg(r.tareWeightKg, 0)}`} />
            <Kpi label={t("Accepted weight")} value={fmtKg(r.acceptedWeightKg, 1)} sub={`${t("Rejected")} ${fmtKg(r.rejectedWeightKg, 1)}`} />
            <Kpi label={t("Average bird weight")} value={fmtKg(r.avgBirdWeightKg, 3)} sub={fmtPct(pct(r.birdsAccepted, r.birdsReceived), 2) + " " + t("accepted")} />
          </div>
          <Card>
            <CardHeader title={t("Delivery & inspection")} actions={<StatusBadge status={r.status} />} />
            <DescriptionList
              cols={3}
              items={[
                { label: t("Supplier"), value: <Link className="link" href={`/app/procurement/suppliers/${r.supplierId}`}>{r.supplier.name}</Link> },
                { label: t("Farm"), value: <Link className="link" href={`/app/procurement/farms/${r.farmId}`}>{`${r.farm.code} — ${r.farm.name}`}</Link> },
                { label: t("Facility"), value: r.facility?.name },
                { label: t("Vehicle plate"), value: r.vehiclePlate },
                { label: t("Driver"), value: r.driverName },
                { label: t("Birds declared"), value: fmtNum(r.birdsDeclared) },
                { label: t("Weighing source"), value: r.weighingSource === "SCALE" ? `${t("Scale")} ${r.scaleDeviceId ?? ""}` : t("Manual entry") },
                { label: t("Quality grade"), value: r.qualityGrade },
                { label: t("Body temperature"), value: r.bodyTempC !== null ? fmtTemp(r.bodyTempC) : "—" },
                { label: t("Feed withdrawal"), value: r.feedWithdrawalHours !== null ? `${r.feedWithdrawalHours} h` : "—" },
                { label: t("Bruising / damage"), value: r.bruisingPct !== null ? fmtPct(r.bruisingPct) : "—" },
                { label: t("Appearance acceptable"), value: r.appearanceOk ? t("Yes") : t("No") },
                { label: t("Veterinary certificate"), value: r.vetCertificateNo },
                { label: t("Price per kg live"), value: r.pricePerKg ? fmtMoney(r.pricePerKg) : "—" },
                { label: t("Delivery value (accepted)"), value: r.pricePerKg ? fmtMoney(num(r.pricePerKg) * r.acceptedWeightKg) : "—" },
                { label: t("Recorded by"), value: `${createdBy} · ${fmtDateTime(r.createdAt, ctx.tz)}` },
                { label: t("Inspection notes"), value: r.inspectionNotes },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={t("Inspection checklists")} />
            {qc.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("No checklist recorded.")}</p>
            ) : (
              qc.map((q) => (
                <div key={q.id} className="mb-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {q.checklist.name} <StatusBadge status={q.result} /> <span className="text-[12px] font-normal text-ink-3">{q.number} · {q.performedByName}</span>
                  </div>
                  <SimpleTable head={[t("Check"), t("Value"), t("Result")]}>
                    {(q.responses as { id: string; label: string; value: unknown; ok: boolean }[]).map((x) => (
                      <tr key={x.id}>
                        <td className="td">{t(x.label)}</td>
                        <td className="td">{typeof x.value === "boolean" ? (x.value ? t("Yes") : t("No")) : String(x.value ?? "—")}</td>
                        <td className="td"><StatusBadge status={x.ok ? "PASS" : "FAIL"} /></td>
                      </tr>
                    ))}
                  </SimpleTable>
                </div>
              ))
            )}
          </Card>
          <DocumentsPanel ctx={ctx} entityType="raw_material_receipt" entityId={r.id} canUpload={ctx.can("receiving.operate")} title="Photos & documents" defaultType="PHOTO" />
        </div>
        <aside className="space-y-4">
          {r.batch ? (
            <Card className="text-center">
              <div className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{t("Batch ID")}</div>
              <div className="mt-1 break-all font-mono text-[15px] font-semibold">{r.batch.code}</div>
              <div className="mx-auto mt-3 w-[180px]" dangerouslySetInnerHTML={{ __html: qr! }} />
              <div className="mt-2"><StatusBadge status={r.batch.status} /></div>
              <div className="mt-3 text-[12px] text-ink-3">
                {t("Processed")}: {fmtNum(r.batch.processedBirds)} / {fmtNum(r.batch.birds)} {t("birds")}
              </div>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
