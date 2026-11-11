import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtKg, fmtMoney, fmtMoneyShort, num } from "@/lib/format";
import { addDays, startOfLocalDay } from "@/lib/tz";
import { Card, CardHeader, ExportLinks, Kpi, PageHeader, Pill } from "@/components/ui/basic";
import { DataTable, type SP } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { BarChartView } from "@/components/charts";
import { EPS } from "@/server/services/inventory";
import { createRetailLocationAction } from "./actions";

export default async function RetailPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "retail.view" });
  const sp = await searchParams;
  const now = new Date();
  const today = startOfLocalDay(now, ctx.tz);
  const data = await withTenant(ctx, async (tx) => {
    const [locs, salesToday, sales7, stock, billz] = await Promise.all([
      tx.retailLocation.findMany({ orderBy: { code: "asc" } }),
      tx.sale.groupBy({ by: ["retailLocationId"], where: { soldAt: { gte: today } }, _sum: { total: true, quantityKg: true }, _count: true }),
      tx.sale.groupBy({ by: ["retailLocationId"], where: { soldAt: { gte: addDays(today, -6) } }, _sum: { total: true } }),
      tx.inventory.groupBy({ by: ["warehouseId"], where: { quantityKg: { gt: EPS }, expiryDate: { gt: now }, warehouse: { type: "RETAIL" } }, _sum: { quantityKg: true } }),
      tx.integration.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: "billz" } } }),
    ]);
    return { locs, salesToday, sales7, stock, billz };
  });
  const t = ctx.t;
  const rows = data.locs.map((l) => ({
    ...l,
    today: num(data.salesToday.find((s) => s.retailLocationId === l.id)?._sum.total),
    todayKg: data.salesToday.find((s) => s.retailLocationId === l.id)?._sum.quantityKg ?? 0,
    receipts: data.salesToday.find((s) => s.retailLocationId === l.id)?._count ?? 0,
    week: num(data.sales7.find((s) => s.retailLocationId === l.id)?._sum.total),
    stockKg: data.stock.find((s) => s.warehouseId === l.warehouseId)?._sum.quantityKg ?? 0,
  }));
  return (
    <>
      <PageHeader
        title={t("Retail Locations")}
        description={t("Branded stores with their own inventory, daily sales, returns and write-offs.")}
        actions={
          <>
            <ExportLinks report="sales" />
            {ctx.can("retail.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New store")}</>} title="New retail location" triggerVariant="primary">
                <ActionForm action={createRetailLocationAction} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <TextInput name="code" label="Code" required placeholder="S11" />
                    <TextInput name="brand" label="Brand" />
                  </div>
                  <TextInput name="name" label="Store name" required />
                  <TextInput name="address" label="Address" />
                  <div className="grid grid-cols-2 gap-3">
                    <TextInput name="region" label="Region" />
                    <TextInput name="phone" label="Phone" />
                  </div>
                  <TextInput name="managerName" label="Store manager" />
                  <SelectInput name="posProvider" label="POS system" placeholder="None / manual entry" options={[{ value: "billz", label: "BILLZ" }]} />
                  <p className="text-[12px] text-ink-3">{t("A store stock location with chilled display and freezer is created automatically. Plan limit")}: {ctx.session.plan?.maxRetailLocations ?? t("Unlimited")}</p>
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Create store</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={t("Stores")} value={String(rows.length)} />
        <Kpi label={t("Sales today")} value={fmtMoneyShort(rows.reduce((s, r) => s + r.today, 0), ctx.tenant.currency)} sub={fmtKg(rows.reduce((s, r) => s + r.todayKg, 0), 0)} />
        <Kpi label={t("Sales last 7 days")} value={fmtMoneyShort(rows.reduce((s, r) => s + r.week, 0), ctx.tenant.currency)} />
        <Kpi label={t("Store stock")} value={fmtKg(rows.reduce((s, r) => s + r.stockKg, 0), 0)} sub={`BILLZ: ${t(data.billz?.status === "CONNECTED" ? "connected" : "not connected — manual entry")}`} />
      </div>
      <Card className="mb-4">
        <CardHeader title={t("Sales by location — last 7 days")} description={ctx.tenant.currency} />
        <BarChartView data={rows.map((r) => ({ name: r.name.replace(" (demo)", ""), sales: Math.round(r.week) }))} xKey="name" horizontal series={[{ key: "sales", label: "Sales" }]} unit={ctx.tenant.currency} digits={0} height={Math.max(200, rows.length * 30)} />
      </Card>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/retail"
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/retail/${r.id}`}
        columns={[
          { key: "code", header: "Code", render: (r) => r.code },
          { key: "name", header: "Store", render: (r) => <><span className="font-medium">{r.name}</span><div className="text-[11.5px] text-ink-3">{r.address}</div></> },
          { key: "mgr", header: "Manager", render: (r) => r.managerName ?? "—" },
          { key: "today", header: "Sales today", align: "right", render: (r) => fmtMoney(r.today) },
          { key: "rc", header: "Sale lines", align: "right", render: (r) => r.receipts },
          { key: "week", header: "7 days", align: "right", render: (r) => fmtMoneyShort(r.week) },
          { key: "stock", header: "Stock", align: "right", render: (r) => fmtKg(r.stockKg, 0) },
          { key: "pos", header: "POS", render: (r) => (r.posProvider ? <Pill>{r.posProvider.toUpperCase()}</Pill> : t("Manual")) },
        ]}
      />
    </>
  );
}
