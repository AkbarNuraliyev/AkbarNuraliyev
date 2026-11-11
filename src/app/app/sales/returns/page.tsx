import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg } from "@/lib/format";
import { PageHeader, Pill } from "@/components/ui/basic";
import { DataTable, listParams, type SP } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { SalesTabs } from "../forms";
import { ReturnForm } from "./return-form";

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "sales.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "createdAt", sortable: ["createdAt"] });
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, products, locations, delivered, whs] = await Promise.all([
      tx.returnRecord.findMany({ include: { customer: true }, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
      tx.returnRecord.count(),
      tx.product.findMany({ select: { id: true, name: true } }),
      tx.retailLocation.findMany({ select: { id: true, name: true } }),
      tx.orderAllocation.findMany({
        where: { status: "SHIPPED", orderItem: { order: { status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] }, deliveredAt: { gte: new Date(Date.now() - 14 * 86400000) } } } },
        include: { orderItem: { include: { product: true, order: { include: { customer: true } } } }, inventory: { include: { batch: true } } },
        orderBy: { createdAt: "desc" },
        take: 400,
      }),
      tx.warehouse.findMany({ where: { type: { not: "RETAIL" }, isActive: true }, include: { chambers: true } }),
    ]);
    return { rows, total, products, locations, delivered, whs };
  });
  const t = ctx.t;
  const pName = new Map(data.products.map((p) => [p.id, p.name]));
  const lName = new Map(data.locations.map((l) => [l.id, l.name]));
  return (
    <>
      <PageHeader
        title={t("Sales & Customers")}
        description={t("Customer returns from B2B deliveries and retail stores. Restocked returns go to quarantine pending a quality decision.")}
        actions={
          ctx.can("sales.operate") && (
            <Modal trigger={t("Record B2B return")} title="Record customer return" size="lg" triggerVariant="primary">
              <ReturnForm
                deliveries={data.delivered.map((a) => ({
                  key: a.id,
                  customerId: a.orderItem.order.customerId,
                  orderId: a.orderItem.orderId,
                  productId: a.orderItem.productId,
                  batchId: a.batchId,
                  label: `${a.orderItem.order.number} · ${a.orderItem.order.customer.name} · ${a.orderItem.product.name} · ${a.inventory.batch.code} · ${a.quantityKg.toFixed(1)} kg`,
                  max: a.quantityKg,
                }))}
                warehouses={data.whs.map((w) => ({ id: w.id, name: w.name, chambers: w.chambers.map((c) => ({ id: c.id, name: c.name, type: c.type })) }))}
              />
            </Modal>
          )
        }
      />
      <SalesTabs current="returns" t={t} />
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/sales/returns"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: "Return", render: (r) => <span className="font-medium">{r.number}</span> },
          { key: "d", header: "Date", render: (r) => fmtDateTime(r.createdAt, ctx.tz) },
          { key: "s", header: "Source", render: (r) => <Pill tone={r.source === "B2B" ? "blue" : "violet"}>{r.source === "B2B" ? "B2B" : t("Retail")}</Pill> },
          { key: "c", header: "Customer / store", render: (r) => r.customer?.name ?? lName.get(r.retailLocationId ?? "") ?? "—" },
          { key: "p", header: "Product", render: (r) => pName.get(r.productId) },
          { key: "b", header: "Batch", render: (r) => <Link href={`/app/traceability/${r.batchId}`} className="link text-[12.5px]">{t("Trace")}</Link> },
          { key: "q", header: "Quantity", align: "right", render: (r) => fmtKg(r.quantityKg, 2) },
          { key: "r", header: "Reason", render: (r) => <span className="text-[12.5px]">{r.reason}</span> },
          { key: "a", header: "Action", render: (r) => <Pill tone={r.action === "RESTOCK" ? "amber" : "red"}>{t(r.action === "RESTOCK" ? "Quarantine" : "Write-off")}</Pill> },
        ]}
      />
    </>
  );
}
