import Link from "@/components/ui/link";
import { requirePortal } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDay, fmtMoney, num } from "@/lib/format";
import { Card, CardHeader, Kpi, LinkButton, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { OPEN_STATUSES } from "@/server/services/orders";

export default async function PortalHome() {
  const ctx = await requirePortal();
  const data = await withTenant(ctx, async (tx) => {
    const [open, recent, invoices] = await Promise.all([
      tx.order.count({ where: { customerId: ctx.customerId, status: { in: OPEN_STATUSES } } }),
      tx.order.findMany({ where: { customerId: ctx.customerId }, orderBy: { createdAt: "desc" }, take: 8 }),
      tx.salesInvoice.findMany({ where: { customerId: ctx.customerId, status: { in: ["UNPAID", "PARTIAL"] } } }),
    ]);
    return { open, recent, invoices };
  });
  const t = ctx.t;
  const outstanding = data.invoices.reduce((s, i) => s + num(i.amount) - num(i.paidAmount), 0);
  return (
    <>
      <PageHeader title={t("Welcome")} description={t("Order at your contract prices, track deliveries and download documents.")} actions={<LinkButton href="/portal/orders/new" variant="primary">{t("New order")}</LinkButton>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi label={t("Open orders")} value={String(data.open)} href="/portal/orders" />
        <Kpi label={t("Outstanding invoices")} value={fmtMoney(outstanding)} sub={t("{n} open invoices", { n: data.invoices.length })} href="/portal/documents" />
        <Kpi label={t("Ordering cut-off")} value={t("Day before")} sub={t("orders are delivered from the next day")} />
      </div>
      <Card className="mt-4">
        <CardHeader title={t("Recent orders")} actions={<Link href="/portal/orders" className="link text-[13px]">{t("All orders")}</Link>} />
        <SimpleTable head={[t("Order"), t("Delivery date"), t("Total"), t("Status")]}>
          {data.recent.map((o) => (
            <tr key={o.id}>
              <td className="td"><Link href={`/portal/orders/${o.id}`} className="link">{o.number}</Link></td>
              <td className="td">{fmtDay(o.requestedDeliveryDate)}</td>
              <td className="td tabular">{fmtMoney(o.total)}</td>
              <td className="td"><StatusBadge status={o.status} /></td>
            </tr>
          ))}
        </SimpleTable>
      </Card>
    </>
  );
}
