import { notFound } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtDay, fmtKg, fmtMoney } from "@/lib/format";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { statusLabel } from "@/lib/status";
import { SimpleTable } from "@/components/ui/table";

export default async function PortalOrder({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePortal();
  const { id } = await params;
  const order = await withTenant(ctx, (tx) =>
    tx.order.findFirst({ where: { id, customerId: ctx.customerId }, include: { items: { include: { product: true } }, history: { orderBy: { createdAt: "asc" } }, invoice: true } }),
  );
  if (!order) notFound();
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={`${t("Order")} ${order.number}`}
        description={`${t("Delivery date")} ${fmtDay(order.requestedDeliveryDate)}`}
        actions={
          <>
            <StatusBadge status={order.status} />
            {order.invoice && <LinkButton href={`/print/order/${order.id}?doc=invoice`} target="_blank" size="sm">{t("Invoice")}</LinkButton>}
            {order.deliveredAt && <LinkButton href={`/print/order/${order.id}?doc=delivery`} target="_blank" size="sm">{t("Delivery note")}</LinkButton>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title={t("Items")} />
          <SimpleTable head={[t("Product"), t("Ordered"), t("Price"), t("Delivered"), t("Amount")]}>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td className="td">{i.product.name}</td>
                <td className="td tabular">{fmtKg(i.quantityKg, 2)}</td>
                <td className="td tabular">{fmtMoney(i.unitPrice)}</td>
                <td className="td tabular">{order.deliveredAt ? fmtKg(i.deliveredKg, 2) : "—"}</td>
                <td className="td tabular">{fmtMoney(i.lineTotal)}</td>
              </tr>
            ))}
          </SimpleTable>
          <div className="mt-3 text-right text-sm font-semibold">{order.deliveredAt ? t("Invoiced") : t("Estimated total")}: {fmtMoney(order.total)}</div>
        </Card>
        <Card>
          <CardHeader title={t("Status")} />
          <ol className="space-y-3">
            {order.history.map((h) => (
              <li key={h.id} className="relative pl-4 text-[13px]">
                <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-brand-600" />
                <div className="font-medium">{t(statusLabel(h.toStatus))}</div>
                <div className="text-[12px] text-ink-3">{fmtDateTime(h.createdAt, ctx.tz)}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
