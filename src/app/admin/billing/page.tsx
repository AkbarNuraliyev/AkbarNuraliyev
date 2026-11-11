import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Alert, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { PaymentConfirm } from "./payment-confirm";

export default async function AdminBilling() {
  const { t } = await requireSuperAdmin();
  const invoices = await withSystem((tx) => tx.billingInvoice.findMany({ include: { tenant: true }, orderBy: [{ status: "asc" }, { issuedAt: "desc" }], take: 300 }));
  return (
    <>
      <PageHeader title={t("Subscription payments")} description={t("Subscription invoices for all organizations.")} />
      <Alert tone="info" className="mb-4">{t("No online payment provider is connected. Payments are confirmed manually after the bank transfer appears on the statement; nothing is marked paid automatically.")}</Alert>
      <SimpleTable head={[t("Invoice"), t("Organization"), t("Description"), t("Issued"), t("Due"), t("Amount"), t("Status"), t("Paid"), ""]}>
        {invoices.map((i) => (
          <tr key={i.id}>
            <td className="td font-mono text-[12px]">{i.number}</td>
            <td className="td"><Link href={`/admin/organizations/${i.tenantId}`} className="link">{i.tenant.name}</Link></td>
            <td className="td">{i.description}</td>
            <td className="td">{fmtDate(i.issuedAt, "Asia/Tashkent")}</td>
            <td className="td">{fmtDate(i.dueAt, "Asia/Tashkent")}</td>
            <td className="td tabular">{fmtMoney(i.amount)}</td>
            <td className="td"><StatusBadge status={i.status} /></td>
            <td className="td text-[12px]">{i.paidAt ? `${fmtDate(i.paidAt, "Asia/Tashkent")} · ${i.paymentRef ?? ""} · ${i.confirmedBy ?? ""}` : "—"}</td>
            <td className="td text-right">{i.status === "UNPAID" && <PaymentConfirm invoiceId={i.id} number={i.number} />}</td>
          </tr>
        ))}
        {invoices.length === 0 && <tr><td colSpan={9} className="td text-center text-ink-3">{t("No invoices yet.")}</td></tr>}
      </SimpleTable>
    </>
  );
}
