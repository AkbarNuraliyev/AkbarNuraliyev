import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtKg, fmtNum, fmtPct, pct } from "@/lib/format";
import { Card, CardHeader, DescriptionList, Kpi, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { Modal } from "@/components/ui/dialog";
import { FarmForm } from "../../forms";
import { ReceiptRows } from "../../receipt-rows";

export default async function FarmDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "procurement.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const f = await tx.farm.findUnique({ where: { id }, include: { supplier: true } });
    if (!f) return null;
    const [receipts, agg, suppliers, y] = await Promise.all([
      tx.rawMaterialReceipt.findMany({ where: { farmId: id }, include: { farm: true, batch: true }, orderBy: { receivedAt: "desc" }, take: 30 }),
      tx.rawMaterialReceipt.aggregate({ where: { farmId: id }, _sum: { birdsReceived: true, birdsAccepted: true, netWeightKg: true, birdsDeadOnArrival: true }, _count: true }),
      tx.supplier.findMany({ select: { id: true, name: true, code: true }, orderBy: { code: "asc" } }),
      tx.$queryRaw<{ input: number; saleable: number }[]>`
        SELECT COALESCE((SELECT SUM(si."inputWeightKg") FROM shift_inputs si JOIN production_batches b ON b.id = si."batchId" WHERE b."farmId" = ${id}), 0)::float AS input,
               COALESCE((SELECT SUM(o."weightKg") FROM production_outputs o JOIN production_batches b ON b.id = o."batchId" WHERE b."farmId" = ${id} AND o."outputType" <> 'WASTE'), 0)::float AS saleable`,
    ]);
    return { f, receipts, agg, suppliers, y: y[0] };
  });
  if (!data) notFound();
  const { f, receipts, agg, suppliers, y } = data;
  const t = ctx.t;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Procurement & Farms"), href: "/app/procurement/farms" }, { label: f.code }]}
        title={f.name}
        description={<Link className="link" href={`/app/procurement/suppliers/${f.supplierId}`}>{f.supplier.name}</Link>}
        actions={
          ctx.can("procurement.manage") && (
            <Modal trigger={<><Pencil className="h-4 w-4" />{t("Edit")}</>} title="Edit farm" size="lg" triggerVariant="primary">
              <FarmForm farm={f} suppliers={suppliers} />
            </Modal>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t("Deliveries")} value={fmtNum(agg._count)} />
        <Kpi label={t("Birds received")} value={fmtNum(agg._sum.birdsReceived ?? 0)} />
        <Kpi label={t("Acceptance rate")} value={fmtPct(pct(agg._sum.birdsAccepted ?? 0, agg._sum.birdsReceived ?? 0), 2)} />
        <Kpi label={t("Avg live weight")} value={agg._sum.birdsReceived ? fmtKg((agg._sum.netWeightKg ?? 0) / agg._sum.birdsReceived, 3) : "—"} />
        <Kpi label={t("Production yield")} value={y.input ? fmtPct(pct(y.saleable, y.input), 2) : "—"} />
      </div>
      <Card className="mt-4">
        <CardHeader title={t("Farm details")} actions={<StatusBadge status={f.isActive ? "ACTIVE" : "INACTIVE"} />} />
        <DescriptionList
          cols={4}
          items={[
            { label: t("Code"), value: f.code },
            { label: t("Region"), value: f.region },
            { label: t("District"), value: f.district },
            { label: t("Address"), value: f.address },
            { label: t("Breed"), value: f.breed },
            { label: t("Capacity (birds)"), value: f.capacityBirds ? fmtNum(f.capacityBirds) : "—" },
            { label: t("Veterinary registration"), value: f.vetRegistration },
            { label: t("Coordinates"), value: f.latitude ? `${f.latitude}, ${f.longitude}` : "—" },
          ]}
        />
      </Card>
      <Card className="mt-4">
        <CardHeader title={t("Deliveries and batches")} />
        <ReceiptRows receipts={receipts} ctx={ctx} />
      </Card>
    </>
  );
}
