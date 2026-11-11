import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtMoney, fmtMoneyShort, num } from "@/lib/format";
import { ExportLinks, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";
import { Modal } from "@/components/ui/dialog";
import { CUSTOMER_TYPES, CustomerForm, SalesTabs, customerTypeLabel } from "./forms";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "sales.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "code", defaultDir: "asc", sortable: ["code", "name", "type", "region"] });
  const type = spGet(sp, "type");
  const where: Prisma.CustomerWhereInput = {
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { code: { contains: lp.q, mode: "insensitive" } }, { taxId: { contains: lp.q } }] } : {}),
    ...(type ? { type: type as "HORECA" } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, priceLists, open, sales30] = await Promise.all([
      tx.customer.findMany({ where, include: { priceList: true, _count: { select: { orders: true, memberships: true } } }, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take }),
      tx.customer.count({ where }),
      tx.priceList.findMany({ orderBy: { name: "asc" } }),
      tx.salesInvoice.groupBy({ by: ["customerId"], where: { status: { in: ["UNPAID", "PARTIAL"] } }, _sum: { amount: true, paidAmount: true } }),
      tx.salesInvoice.groupBy({ by: ["customerId"], where: { issuedAt: { gte: new Date(Date.now() - 30 * 86400000) } }, _sum: { amount: true } }),
    ]);
    return { rows, total, priceLists, open, sales30 };
  });
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Sales & Customers")}
        description={t("B2B customers (HoReCa, retail chains, distributors, wholesale), contract prices, receivables and returns.")}
        actions={
          <>
            <ExportLinks report="customers" />
            {ctx.can("sales.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New customer")}</>} title="New customer" size="lg" triggerVariant="primary">
                <CustomerForm priceLists={data.priceLists} />
              </Modal>
            )}
          </>
        }
      />
      <SalesTabs current="customers" t={t} />
      <Toolbar>
        <SearchBox placeholder="Search name, code, TIN…" />
        <FilterSelect param="type" label="Type" options={CUSTOMER_TYPES} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/sales"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/sales/customers/${r.id}`}
        columns={[
          { key: "code", header: "Code", sortKey: "code", render: (r) => r.code },
          { key: "name", header: "Customer", sortKey: "name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "type", header: "Type", sortKey: "type", render: (r) => <Pill>{customerTypeLabel(t, r.type)}</Pill> },
          { key: "region", header: "Region", sortKey: "region", render: (r) => r.region ?? "—" },
          { key: "pl", header: "Price list", render: (r) => r.priceList?.name ?? t("Base prices") },
          { key: "terms", header: "Terms", align: "right", render: (r) => `${r.paymentTermsDays} ${t("days")}` },
          { key: "s30", header: "Sales 30 d", align: "right", render: (r) => fmtMoneyShort(num(data.sales30.find((x) => x.customerId === r.id)?._sum.amount)) },
          {
            key: "ar",
            header: "Outstanding",
            align: "right",
            render: (r) => {
              const o = data.open.find((x) => x.customerId === r.id);
              const v = num(o?._sum.amount) - num(o?._sum.paidAmount);
              return <span className={r.creditLimit && v > num(r.creditLimit) ? "font-medium text-red-700" : ""}>{fmtMoney(v)}</span>;
            },
          },
          { key: "portal", header: "Portal users", align: "right", render: (r) => r._count.memberships },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
        ]}
      />
    </>
  );
}
