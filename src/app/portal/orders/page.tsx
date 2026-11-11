import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtDay, fmtKg, fmtMoney } from "@/lib/format";
import { LinkButton, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";

export default async function PortalOrders() {
  const ctx = await requirePortal();
  const orders = await withTenant(ctx, (tx) => tx.order.findMany({ where: { customerId: ctx.customerId }, include: { items: { select: { quantityKg: true } } }, orderBy: { createdAt: "desc" }, take: 200 }));
  const t = ctx.t;
  return (
    <>
      <PageHeader title={t("My orders")} actions={<LinkButton href="/portal/orders/new" variant="primary">{t("New order")}</LinkButton>} />
      <SimpleTable head={[t("Order"), t("Placed"), t("Delivery date"), t("Quantity"), t("Total"), t("Status")]}>
        {orders.map((o) => (
          <tr key={o.id}>
            <td className="td"><Link href={`/portal/orders/${o.id}`} className="link">{o.number}</Link></td>
            <td className="td">{fmtDateTime(o.orderDate, ctx.tz)}</td>
            <td className="td">{fmtDay(o.requestedDeliveryDate)}</td>
            <td className="td tabular">{fmtKg(o.items.reduce((s, i) => s + i.quantityKg, 0), 1)}</td>
            <td className="td tabular">{fmtMoney(o.total)}</td>
            <td className="td"><StatusBadge status={o.status} /></td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
