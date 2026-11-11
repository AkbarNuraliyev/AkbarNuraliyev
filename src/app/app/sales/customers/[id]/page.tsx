import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Pencil, UserPlus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtDay, fmtKg, fmtMoney, fmtPct, num, pct } from "@/lib/format";
import { Card, CardHeader, DescriptionList, Kpi, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, ResultLink, SubmitButton, TextInput } from "@/components/ui/form";
import { CustomerForm, customerTypeLabel } from "../../forms";
import { invitePortalUserAction } from "../../actions";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "sales.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const c = await tx.customer.findUnique({ where: { id }, include: { priceList: true, memberships: { include: { user: true } }, invitations: { where: { acceptedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" } } } });
    if (!c) return null;
    const [orders, invoices, priceLists, otif, returns] = await Promise.all([
      tx.order.findMany({ where: { customerId: id }, include: { items: { select: { quantityKg: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
      tx.salesInvoice.findMany({ where: { customerId: id }, orderBy: { issuedAt: "desc" }, take: 20 }),
      tx.priceList.findMany({ orderBy: { name: "asc" } }),
      tx.order.findMany({ where: { customerId: id, deliveredAt: { not: null } }, select: { onTime: true, inFull: true } }),
      tx.returnRecord.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);
    return { c, orders, invoices, priceLists, otif, returns };
  });
  if (!data) notFound();
  const { c } = data;
  const t = ctx.t;
  const outstanding = data.invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL").reduce((s, i) => s + num(i.amount) - num(i.paidAmount), 0);
  const overdue = data.invoices.filter((i) => (i.status === "UNPAID" || i.status === "PARTIAL") && i.dueAt < new Date()).reduce((s, i) => s + num(i.amount) - num(i.paidAmount), 0);
  const otifPct = data.otif.length ? pct(data.otif.filter((o) => o.onTime && o.inFull).length, data.otif.length) : null;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Sales & Customers"), href: "/app/sales" }, { label: c.code }]}
        title={c.name}
        description={`${customerTypeLabel(t, c.type)} · ${c.region ?? "—"} · ${c.priceList?.name ?? t("Base prices")}`}
        actions={
          <>
            {ctx.can("sales.manage") && ctx.has("b2b_portal") && (
              <Modal trigger={<><UserPlus className="h-4 w-4" />{t("Invite portal user")}</>} title="Invite customer to the B2B portal">
                <ActionForm action={invitePortalUserAction} className="space-y-3" closeOnSuccess={false} resetOnSuccess>
                  <Hidden name="customerId" value={c.id} />
                  <TextInput name="email" label="Buyer email" type="email" required />
                  <p className="text-[12px] text-ink-3">{t("The buyer will see only this customer's catalog, contract prices, orders and documents.")}</p>
                  <ResultLink />
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Send invitation</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
            {ctx.can("sales.manage") && (
              <Modal trigger={<><Pencil className="h-4 w-4" />{t("Edit")}</>} title="Edit customer" size="lg" triggerVariant="primary">
                <CustomerForm customer={c} priceLists={data.priceLists} />
              </Modal>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={t("Orders")} value={String(data.orders.length >= 20 ? "20+" : data.orders.length)} />
        <Kpi label={t("OTIF")} value={otifPct === null ? "—" : fmtPct(otifPct)} sub={t("{n} delivered orders", { n: data.otif.length })} />
        <Kpi label={t("Outstanding")} value={fmtMoney(outstanding)} sub={c.creditLimit ? `${t("Credit limit")} ${fmtMoney(c.creditLimit)}` : undefined} tone={c.creditLimit && outstanding > num(c.creditLimit) ? "critical" : "default"} />
        <Kpi label={t("Overdue")} value={fmtMoney(overdue)} tone={overdue > 0 ? "warning" : "good"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("Customer details")} actions={<StatusBadge status={c.isActive ? "ACTIVE" : "INACTIVE"} />} />
          <DescriptionList
            cols={3}
            items={[
              { label: t("Code"), value: c.code },
              { label: t("TIN"), value: c.taxId },
              { label: t("Contact person"), value: c.contactName },
              { label: t("Phone"), value: c.phone },
              { label: t("Email"), value: c.email },
              { label: t("Payment terms"), value: `${c.paymentTermsDays} ${t("days")}` },
              { label: t("Legal address"), value: c.address },
              { label: t("Delivery address"), value: c.deliveryAddress },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("B2B portal access")} />
          {c.memberships.length === 0 && c.invitations.length === 0 && <p className="text-[13px] text-ink-3">{t("No portal users yet.")}</p>}
          <ul className="space-y-2 text-[13px]">
            {c.memberships.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2"><span>{m.user.name}<div className="text-[12px] text-ink-3">{m.user.email}</div></span><StatusBadge status={m.status} /></li>
            ))}
            {c.invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2"><span>{i.email}<div className="text-[12px] text-ink-3">{t("Invited, expires")} {fmtDate(i.expiresAt, ctx.tz)}</div></span><StatusBadge status="PENDING" /></li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Recent orders")} actions={<Link href={`/app/orders?customer=${c.id}&status=all`} className="link text-[13px]">{t("All orders")}</Link>} />
          <SimpleTable head={[t("Order"), t("Delivery"), t("Kg"), t("Total"), t("Status")]}>
            {data.orders.map((o) => (
              <tr key={o.id}>
                <td className="td"><Link href={`/app/orders/${o.id}`} className="link">{o.number}</Link></td>
                <td className="td">{fmtDay(o.requestedDeliveryDate)}</td>
                <td className="td tabular">{fmtKg(o.items.reduce((s, i) => s + i.quantityKg, 0), 0)}</td>
                <td className="td tabular">{fmtMoney(o.total)}</td>
                <td className="td"><StatusBadge status={o.status} /></td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
        <Card>
          <CardHeader title={t("Invoices")} actions={<Link href={`/app/sales/receivables?customer=${c.id}`} className="link text-[13px]">{t("Receivables")}</Link>} />
          <SimpleTable head={[t("Invoice"), t("Issued"), t("Due"), t("Amount"), t("Paid"), t("Status")]}>
            {data.invoices.map((i) => (
              <tr key={i.id}>
                <td className="td">{i.number}</td>
                <td className="td">{fmtDate(i.issuedAt, ctx.tz)}</td>
                <td className={`td ${i.dueAt < new Date() && i.status !== "PAID" ? "text-red-700" : ""}`}>{fmtDate(i.dueAt, ctx.tz)}</td>
                <td className="td tabular">{fmtMoney(i.amount)}</td>
                <td className="td tabular">{fmtMoney(i.paidAmount)}</td>
                <td className="td"><StatusBadge status={i.status} /></td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
      </div>
      {data.returns.length > 0 && (
        <Card className="mt-4">
          <CardHeader title={t("Returns")} />
          <SimpleTable head={[t("Return"), t("Date"), t("Quantity"), t("Reason"), t("Action")]}>
            {data.returns.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.number}</td>
                <td className="td">{fmtDateTime(r.createdAt, ctx.tz)}</td>
                <td className="td tabular">{fmtKg(r.quantityKg, 2)}</td>
                <td className="td">{r.reason}</td>
                <td className="td">{t(r.action === "RESTOCK" ? "Quarantine" : "Write-off")}</td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
      )}
    </>
  );
}
