import { Plus, Upload } from "lucide-react";
import type { OrderStatus, Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtDay, fmtKg, fmtMoney } from "@/lib/format";
import { ExportLinks, LinkButton, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, qs, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";
import Link from "next/link";
import { OPEN_STATUSES } from "@/server/services/orders";

const STATUS_TABS: { key: string; label: string; statuses?: OrderStatus[] }[] = [
  { key: "open", label: "Open", statuses: OPEN_STATUSES },
  { key: "NEW", label: "New", statuses: ["NEW"] },
  { key: "CONFIRMED", label: "Confirmed", statuses: ["CONFIRMED"] },
  { key: "ALLOCATED", label: "In Production / Allocated", statuses: ["ALLOCATED"] },
  { key: "PICKING", label: "Picking", statuses: ["PICKING"] },
  { key: "READY_FOR_DISPATCH", label: "Ready for Dispatch", statuses: ["READY_FOR_DISPATCH"] },
  { key: "IN_DELIVERY", label: "In Delivery", statuses: ["IN_DELIVERY"] },
  { key: "delivered", label: "Delivered", statuses: ["DELIVERED", "PARTIALLY_DELIVERED"] },
  { key: "CANCELLED", label: "Cancelled", statuses: ["CANCELLED"] },
  { key: "all", label: "All" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "orders.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "createdAt", sortable: ["createdAt", "number", "requestedDeliveryDate", "total", "customer.name"], pageSize: 30 });
  const tab = STATUS_TABS.find((x) => x.key === (spGet(sp, "status") ?? "open")) ?? STATUS_TABS[0];
  const customer = spGet(sp, "customer");
  const source = spGet(sp, "source");
  const date = spGet(sp, "date");
  const where: Prisma.OrderWhereInput = {
    ...(tab.statuses ? { status: { in: tab.statuses } } : {}),
    ...(customer ? { customerId: customer } : {}),
    ...(source ? { source: source as "MANUAL" } : {}),
    ...(date ? { requestedDeliveryDate: new Date(`${date}T00:00:00Z`) } : {}),
    ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { externalRef: { contains: lp.q, mode: "insensitive" } }, { customer: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, counts, customers] = await Promise.all([
      tx.order.findMany({ where, include: { customer: true, items: { select: { quantityKg: true, allocatedKg: true, deliveredKg: true } } }, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take }),
      tx.order.count({ where }),
      tx.order.groupBy({ by: ["status"], _count: true }),
      tx.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return { rows, total, counts, customers };
  });
  const t = ctx.t;
  const countOf = (s?: OrderStatus[]) => (s ? data.counts.filter((c) => s.includes(c.status)).reduce((a, c) => a + c._count, 0) : data.counts.reduce((a, c) => a + c._count, 0));
  return (
    <>
      <PageHeader
        title={t("B2B Orders")}
        description={t("Order lifecycle: New → Confirmed → In Production / Allocated → Picking → Ready for Dispatch → In Delivery → Delivered.")}
        actions={
          <>
            <ExportLinks report="orders" />
            {ctx.can("orders.operate") && (
              <>
                <LinkButton href="/app/orders/import"><Upload className="h-4 w-4" /> {t("Import")}</LinkButton>
                <LinkButton href="/app/orders/new" variant="primary"><Plus className="h-4 w-4" /> {t("New order")}</LinkButton>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 -mx-1 overflow-x-auto">
        <div className="flex min-w-max gap-1.5 px-1">
          {STATUS_TABS.map((s) => (
            <Link
              key={s.key}
              href={`/app/orders${qs(sp, { status: s.key, page: null })}`}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium ${tab.key === s.key ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-ink-2 hover:bg-slate-50"}`}
            >
              {t(s.label)} <span className="ml-1 opacity-70">{countOf(s.statuses)}</span>
            </Link>
          ))}
        </div>
      </div>
      <Toolbar>
        <SearchBox placeholder="Order number, customer, external ref…" />
        <FilterSelect param="customer" label="Customer" translate={false} options={data.customers.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect param="source" label="Source" options={[{ value: "MANUAL", label: "Manual" }, { value: "PORTAL", label: "Portal" }, { value: "IMPORT", label: "Import" }, { value: "API", label: "API" }]} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/orders"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/orders/${r.id}`}
        columns={[
          { key: "n", header: "Order", sortKey: "number", render: (r) => r.number },
          { key: "c", header: "Customer", sortKey: "customer.name", render: (r) => <>{r.customer.name}<div className="text-[11.5px] text-ink-3">{t(r.customer.type === "RETAIL_CHAIN" ? "Retail chain" : r.customer.type === "HORECA" ? "HoReCa" : r.customer.type.charAt(0) + r.customer.type.slice(1).toLowerCase())}</div></> },
          { key: "d", header: "Delivery date", sortKey: "requestedDeliveryDate", render: (r) => fmtDay(r.requestedDeliveryDate) },
          { key: "kg", header: "Ordered", align: "right", render: (r) => fmtKg(r.items.reduce((s, i) => s + i.quantityKg, 0), 0) },
          {
            key: "al",
            header: "Allocated / delivered",
            align: "right",
            render: (r) => {
              const q = r.items.reduce((s, i) => s + i.quantityKg, 0);
              const a = r.items.reduce((s, i) => s + (r.deliveredAt ? i.deliveredKg : i.allocatedKg), 0);
              const pctv = q ? (a / q) * 100 : 0;
              return <span className={pctv < 98 && r.status !== "NEW" && r.status !== "CONFIRMED" && r.status !== "CANCELLED" ? "text-amber-700" : ""}>{Math.round(pctv)}%</span>;
            },
          },
          { key: "t", header: "Total", sortKey: "total", align: "right", render: (r) => fmtMoney(r.total) },
          { key: "src", header: "Source", render: (r) => <Pill>{t(r.source.charAt(0) + r.source.slice(1).toLowerCase())}</Pill> },
          { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "at", header: "Created", sortKey: "createdAt", render: (r) => <span className="whitespace-nowrap text-[12.5px] text-ink-3">{fmtDateTime(r.createdAt, ctx.tz)}</span> },
        ]}
      />
    </>
  );
}
