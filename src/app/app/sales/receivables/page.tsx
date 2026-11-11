import Link from "@/components/ui/link";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtMoney, fmtMoneyShort, num } from "@/lib/format";
import { localDateKey } from "@/lib/tz";
import { ExportLinks, Kpi, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { recordPaymentAction } from "../../orders/actions";
import { SalesTabs } from "../forms";

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "sales.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "dueAt", defaultDir: "asc", sortable: ["dueAt", "issuedAt", "amount", "number", "customer.name"] });
  const status = spGet(sp, "status") ?? "open";
  const customer = spGet(sp, "customer");
  const now = new Date();
  const where: Prisma.SalesInvoiceWhereInput = {
    ...(status === "open" ? { status: { in: ["UNPAID", "PARTIAL"] } } : status === "overdue" ? { status: { in: ["UNPAID", "PARTIAL"] }, dueAt: { lt: now } } : status !== "all" ? { status: status as "PAID" } : {}),
    ...(customer ? { customerId: customer } : {}),
    ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { customer: { name: { contains: lp.q, mode: "insensitive" } } }, { order: { number: { contains: lp.q, mode: "insensitive" } } }] } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, open, customers] = await Promise.all([
      tx.salesInvoice.findMany({ where, include: { customer: true, order: true }, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take }),
      tx.salesInvoice.count({ where }),
      tx.salesInvoice.findMany({ where: { status: { in: ["UNPAID", "PARTIAL"] } }, select: { amount: true, paidAmount: true, dueAt: true } }),
      tx.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return { rows, total, open, customers };
  });
  const t = ctx.t;
  const outstanding = (xs: typeof data.open) => xs.reduce((s, i) => s + num(i.amount) - num(i.paidAmount), 0);
  const ageDays = (d: Date) => Math.floor((now.getTime() - d.getTime()) / 86400000);
  const bucket = (min: number, max: number) => outstanding(data.open.filter((i) => { const a = ageDays(i.dueAt); return a >= min && a <= max; }));
  const today = localDateKey(now, ctx.tz);
  return (
    <>
      <PageHeader title={t("Sales & Customers")} description={t("Outstanding receivables by due date with aging. Payments are recorded manually or imported from accounting.")} actions={<ExportLinks report="receivables" />} />
      <SalesTabs current="receivables" t={t} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t("Outstanding")} value={fmtMoneyShort(outstanding(data.open))} sub={t("{n} open invoices", { n: data.open.length })} />
        <Kpi label={t("Not yet due")} value={fmtMoneyShort(outstanding(data.open.filter((i) => i.dueAt >= now)))} />
        <Kpi label={t("Overdue 1–15 days")} value={fmtMoneyShort(bucket(0, 15))} tone="warning" />
        <Kpi label={t("Overdue 16–30 days")} value={fmtMoneyShort(bucket(16, 30))} tone="warning" />
        <Kpi label={t("Overdue > 30 days")} value={fmtMoneyShort(bucket(31, 100000))} tone="critical" />
      </div>
      <Toolbar>
        <SearchBox placeholder="Invoice, order, customer…" />
        <FilterSelect param="status" label="Status" allLabel="Open" options={[{ value: "overdue", label: "Overdue" }, { value: "PAID", label: "Paid" }, { value: "all", label: "All" }]} />
        <FilterSelect param="customer" label="Customer" translate={false} options={data.customers.map((c) => ({ value: c.id, label: c.name }))} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/sales/receivables"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: "Invoice", sortKey: "number", render: (r) => <span className="font-medium">{r.number}</span> },
          { key: "o", header: "Order", render: (r) => <Link href={`/app/orders/${r.orderId}`} className="link">{r.order.number}</Link> },
          { key: "c", header: "Customer", sortKey: "customer.name", render: (r) => r.customer.name },
          { key: "i", header: "Issued", sortKey: "issuedAt", render: (r) => fmtDate(r.issuedAt, ctx.tz) },
          { key: "d", header: "Due", sortKey: "dueAt", render: (r) => <span className={r.dueAt < now && r.status !== "PAID" ? "font-medium text-red-700" : ""}>{fmtDate(r.dueAt, ctx.tz)}{r.dueAt < now && r.status !== "PAID" && <div className="text-[11.5px]">{ageDays(r.dueAt)} {t("days overdue")}</div>}</span> },
          { key: "a", header: "Amount", sortKey: "amount", align: "right", render: (r) => fmtMoney(r.amount) },
          { key: "out", header: "Outstanding", align: "right", render: (r) => fmtMoney(num(r.amount) - num(r.paidAmount)) },
          { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "pay",
            header: "",
            render: (r) =>
              ctx.can("sales.operate") && (r.status === "UNPAID" || r.status === "PARTIAL") ? (
                <Modal trigger={t("Record payment")} title="Record payment" triggerSize="sm" triggerVariant="ghost">
                  <ActionForm action={recordPaymentAction} className="space-y-3">
                    <Hidden name="invoiceId" value={r.id} />
                    <NumberInput name="amount" label="Amount" required defaultValue={num(r.amount) - num(r.paidAmount)} suffix="UZS" />
                    <TextInput name="paidAt" label="Payment date" type="date" required defaultValue={today} />
                    <SelectInput name="method" label="Method" defaultValue="BANK_TRANSFER" translateOptions options={[{ value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "CASH", label: "Cash" }, { value: "CARD", label: "Card" }, { value: "OFFSET", label: "Offset" }]} />
                    <TextInput name="reference" label="Payment reference" />
                    <FormError />
                    <div className="flex justify-end"><SubmitButton>Save payment</SubmitButton></div>
                  </ActionForm>
                </Modal>
              ) : null,
          },
        ]}
      />
    </>
  );
}
