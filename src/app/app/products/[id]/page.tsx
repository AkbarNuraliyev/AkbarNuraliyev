import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtMoney, fmtTemp } from "@/lib/format";
import { Card, CardHeader, DescriptionList, Kpi, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { DocumentsPanel } from "@/components/app/documents";
import { EPS } from "@/server/services/inventory";
import { ProductForm } from "../forms";

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "products.view" });
  const { id } = await params;
  const now = new Date();
  const data = await withTenant(ctx, async (tx) => {
    const p = await tx.product.findUnique({ where: { id }, include: { category: true, priceItems: { include: { priceList: true } } } });
    if (!p) return null;
    const [cats, lots, image] = await Promise.all([
      tx.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
      tx.inventory.findMany({ where: { productId: id, quantityKg: { gt: EPS } }, include: { batch: true, warehouse: true, chamber: true }, orderBy: { expiryDate: "asc" }, take: 30 }),
      p.imageDocumentId ? tx.document.findUnique({ where: { id: p.imageDocumentId } }) : null,
    ]);
    return { p, cats, lots, image };
  });
  if (!data) notFound();
  const { p, lots } = data;
  const t = ctx.t;
  const total = lots.reduce((s, l) => s + l.quantityKg, 0);
  const reserved = lots.reduce((s, l) => s + l.reservedKg, 0);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Products & Labels"), href: "/app/products" }, { label: p.sku }]}
        title={p.name}
        description={`${p.sku} · ${t(p.category.name)}`}
        actions={
          ctx.can("products.manage") && (
            <Modal trigger={<><Pencil className="h-4 w-4" />{t("Edit")}</>} title="Edit product" size="xl" triggerVariant="primary">
              <ProductForm product={p} categories={data.cats} />
            </Modal>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={t("Stock on hand")} value={fmtKg(total, 1)} sub={t("{n} lots", { n: lots.length })} />
        <Kpi label={t("Reserved for orders")} value={fmtKg(reserved, 1)} />
        <Kpi label={t("Selling price")} value={fmtMoney(p.price)} sub={p.isVariableWeight ? t("per kg") : t("per pack")} />
        <Kpi label={t("Shelf life")} value={p.shelfLifeHours >= 720 ? `${Math.round(p.shelfLifeHours / 24)} ${t("days")}` : `${p.shelfLifeHours} h`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("Product master data")} actions={<StatusBadge status={p.isActive ? "ACTIVE" : "INACTIVE"} />} />
          <div className="flex flex-col gap-5 sm:flex-row">
            {data.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${data.image.id}`} alt={p.name} className="h-36 w-36 shrink-0 rounded-lg border border-line object-cover" />
            )}
            <DescriptionList
              cols={3}
              items={[
                { label: t("Storage"), value: <Pill tone={p.storageType === "FROZEN" ? "blue" : "green"}>{t(p.storageType === "FROZEN" ? "Frozen" : "Chilled")}</Pill> },
                { label: t("Storage temperature"), value: `${p.storageTempMin !== null ? fmtTemp(p.storageTempMin) : "—"} … ${p.storageTempMax !== null ? fmtTemp(p.storageTempMax) : "—"}` },
                { label: t("Storage instructions"), value: p.storageInstructions },
                { label: t("Weight"), value: p.isVariableWeight ? t("Variable weight") : `${p.netWeightKg} kg ${t("fixed")}` },
                { label: t("PLU"), value: p.pluCode },
                { label: t("EAN-13 barcode"), value: p.barcode },
                { label: t("Cost per kg"), value: p.costPerKg ? fmtMoney(p.costPerKg) : "—" },
                { label: t("Minimum stock"), value: p.minStockKg ? fmtKg(p.minStockKg, 0) : "—" },
                { label: t("Target yield"), value: p.targetYieldPct ? `${p.targetYieldPct}%` : "—" },
                { label: t("Batch tracking"), value: p.batchTracking ? t("Yes") : t("No") },
                { label: t("By-product"), value: p.isByproduct ? t("Yes") : t("No") },
                { label: t("Description"), value: p.description },
                { label: t("Ingredients"), value: p.ingredients },
              ]}
            />
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Contract prices")} />
            <SimpleTable head={[t("Price list"), t("Price")]}>
              {p.priceItems.map((pi) => (
                <tr key={pi.id}>
                  <td className="td">{pi.priceList.name}</td>
                  <td className="td tabular">{fmtMoney(pi.price)}</td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <DocumentsPanel ctx={ctx} entityType="product" entityId={p.id} canUpload={ctx.can("products.manage")} title="Product image & specifications" defaultType="IMAGE" />
        </div>
      </div>
      <Card className="mt-4">
        <CardHeader title={t("Stock by batch (FEFO order)")} actions={<Link href={`/app/inventory?product=${p.id}`} className="link text-[13px]">{t("Inventory")}</Link>} />
        <SimpleTable head={[t("Batch"), t("Location"), t("Produced"), t("Expires"), t("Quantity"), t("Reserved"), t("Status")]}>
          {lots.map((l) => (
            <tr key={l.id}>
              <td className="td"><Link className="font-mono text-[12.5px] text-navy-700 hover:underline" href={`/app/traceability/${l.batchId}`}>{l.batch.code}</Link></td>
              <td className="td">{l.warehouse.name}<div className="text-[12px] text-ink-3">{l.chamber?.name}</div></td>
              <td className="td whitespace-nowrap">{fmtDateTime(l.productionDate, ctx.tz)}</td>
              <td className={`td whitespace-nowrap ${l.expiryDate < now ? "font-medium text-red-700" : ""}`}>{fmtDateTime(l.expiryDate, ctx.tz)}</td>
              <td className="td tabular">{fmtKg(l.quantityKg, 2)}</td>
              <td className="td tabular">{fmtKg(l.reservedKg, 2)}</td>
              <td className="td"><StatusBadge status={l.expiryDate < now ? "EXPIRED" : l.status} /></td>
            </tr>
          ))}
        </SimpleTable>
      </Card>
    </>
  );
}
