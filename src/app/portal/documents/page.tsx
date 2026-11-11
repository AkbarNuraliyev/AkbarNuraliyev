import { requirePortal } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";

export default async function PortalDocuments() {
  const ctx = await requirePortal();
  const invoices = await withTenant(ctx, (tx) => tx.salesInvoice.findMany({ where: { customerId: ctx.customerId }, include: { order: true }, orderBy: { issuedAt: "desc" }, take: 200 }));
  const t = ctx.t;
  return (
    <>
      <PageHeader title={t("Documents")} description={t("Invoices and delivery notes for delivered orders. Electronic invoices (Didox / Faktura.uz) are not connected; these are printable documents.")} />
      <SimpleTable head={[t("Invoice"), t("Order"), t("Issued"), t("Due"), t("Amount"), t("Paid"), t("Status"), ""]}>
        {invoices.map((i) => (
          <tr key={i.id}>
            <td className="td">{i.number}</td>
            <td className="td">{i.order.number}</td>
            <td className="td">{fmtDate(i.issuedAt, ctx.tz)}</td>
            <td className="td">{fmtDate(i.dueAt, ctx.tz)}</td>
            <td className="td tabular">{fmtMoney(i.amount)}</td>
            <td className="td tabular">{fmtMoney(i.paidAmount)}</td>
            <td className="td"><StatusBadge status={i.status} /></td>
            <td className="td whitespace-nowrap text-[13px]">
              <a className="link" href={`/print/order/${i.orderId}?doc=invoice`} target="_blank" rel="noreferrer">{t("Invoice")}</a>
              {" · "}
              <a className="link" href={`/print/order/${i.orderId}?doc=delivery`} target="_blank" rel="noreferrer">{t("Delivery note")}</a>
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
