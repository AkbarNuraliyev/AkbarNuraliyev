import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtDay, fmtKg, fmtMoney, fmtNum, fmtPct, pct } from "@/lib/format";
import { Card, CardHeader, DescriptionList, Kpi, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { DocumentsPanel } from "@/components/app/documents";
import { ReceiptRows } from "../../receipt-rows";
import { FarmForm, SupplierForm } from "../../forms";

export default async function SupplierDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "procurement.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const s = await tx.supplier.findUnique({ where: { id }, include: { farms: { include: { _count: { select: { receipts: true } } }, orderBy: { code: "asc" } } } });
    if (!s) return null;
    const [receipts, agg, yieldRows] = await Promise.all([
      tx.rawMaterialReceipt.findMany({ where: { supplierId: id }, include: { farm: true, batch: true }, orderBy: { receivedAt: "desc" }, take: 25 }),
      tx.rawMaterialReceipt.aggregate({ where: { supplierId: id }, _sum: { birdsReceived: true, birdsAccepted: true, birdsDeadOnArrival: true, netWeightKg: true, acceptedWeightKg: true }, _count: true }),
      tx.$queryRaw<{ input: number; saleable: number }[]>`
        SELECT COALESCE((SELECT SUM(si."inputWeightKg") FROM shift_inputs si JOIN production_batches b ON b.id = si."batchId" WHERE b."supplierId" = ${id}), 0)::float AS input,
               COALESCE((SELECT SUM(o."weightKg") FROM production_outputs o JOIN production_batches b ON b.id = o."batchId" WHERE b."supplierId" = ${id} AND o."outputType" <> 'WASTE'), 0)::float AS saleable`,
    ]);
    return { s, receipts, agg, y: yieldRows[0] };
  });
  if (!data) notFound();
  const { s, receipts, agg, y } = data;
  const t = ctx.t;
  const canManage = ctx.can("procurement.manage");
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Procurement & Farms"), href: "/app/procurement" }, { label: s.code }]}
        title={s.name}
        description={`${t(s.type.charAt(0) + s.type.slice(1).toLowerCase())} · ${s.region ?? "—"}`}
        actions={
          canManage && (
            <>
              <Modal trigger={<><Plus className="h-4 w-4" />{t("Add farm")}</>} title="New farm" size="lg">
                <FarmForm suppliers={[{ id: s.id, name: s.name, code: s.code }]} supplierId={s.id} />
              </Modal>
              <Modal trigger={<><Pencil className="h-4 w-4" />{t("Edit")}</>} title="Edit supplier" size="lg" triggerVariant="primary">
                <SupplierForm supplier={s} />
              </Modal>
            </>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label={t("Deliveries")} value={fmtNum(agg._count)} />
        <Kpi label={t("Birds received")} value={fmtNum(agg._sum.birdsReceived ?? 0)} />
        <Kpi label={t("Acceptance rate")} value={fmtPct(pct(agg._sum.birdsAccepted ?? 0, agg._sum.birdsReceived ?? 0), 2)} />
        <Kpi label={t("DOA rate")} value={fmtPct(pct(agg._sum.birdsDeadOnArrival ?? 0, agg._sum.birdsReceived ?? 0), 2)} />
        <Kpi label={t("Avg live weight")} value={agg._sum.birdsReceived ? fmtKg((agg._sum.netWeightKg ?? 0) / agg._sum.birdsReceived, 3) : "—"} />
        <Kpi label={t("Production yield")} value={y.input ? fmtPct(pct(y.saleable, y.input), 2) : "—"} sub={t("from this supplier's batches")} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("Supplier details")} actions={<StatusBadge status={s.isActive ? "ACTIVE" : "INACTIVE"} />} />
          <DescriptionList
            cols={3}
            items={[
              { label: t("Code"), value: s.code },
              { label: t("TIN"), value: s.taxId },
              { label: t("Contact person"), value: s.contactName },
              { label: t("Phone"), value: s.phone },
              { label: t("Email"), value: s.email },
              { label: t("Address"), value: s.address },
              { label: t("Contract number"), value: s.contractNumber },
              { label: t("Contract period"), value: s.contractStart ? `${fmtDay(s.contractStart)} – ${fmtDay(s.contractEnd)}` : "—" },
              { label: t("Payment terms"), value: s.paymentTermsDays !== null ? `${s.paymentTermsDays} ${t("days")}` : "—" },
              { label: t("Price per kg live weight"), value: s.pricePerKgLive ? fmtMoney(s.pricePerKgLive) : "—" },
              { label: t("Notes"), value: s.notes },
            ]}
          />
        </Card>
        <DocumentsPanel ctx={ctx} entityType="supplier" entityId={s.id} canUpload={canManage} title="Contracts & documents" defaultType="CONTRACT" />
      </div>
      <Card className="mt-4">
        <CardHeader title={t("Farms")} description={t("{n} farms", { n: s.farms.length })} />
        <SimpleTable head={[t("Code"), t("Farm"), t("Region"), t("Breed"), t("Capacity"), t("Deliveries"), t("Status")]}>
          {s.farms.map((f) => (
            <tr key={f.id}>
              <td className="td"><Link className="link" href={`/app/procurement/farms/${f.id}`}>{f.code}</Link></td>
              <td className="td">{f.name}</td>
              <td className="td">{f.region}</td>
              <td className="td">{f.breed ?? "—"}</td>
              <td className="td tabular">{f.capacityBirds ? fmtNum(f.capacityBirds) : "—"}</td>
              <td className="td tabular">{f._count.receipts}</td>
              <td className="td"><StatusBadge status={f.isActive ? "ACTIVE" : "INACTIVE"} /></td>
            </tr>
          ))}
        </SimpleTable>
      </Card>
      <Card className="mt-4">
        <CardHeader title={t("Recent deliveries")} actions={<Link href={`/app/receiving?supplier=${s.id}`} className="link text-[13px]">{t("All deliveries")}</Link>} />
        <ReceiptRows receipts={receipts} ctx={ctx} />
      </Card>
    </>
  );
}
