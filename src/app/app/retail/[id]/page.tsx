import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtMoney, fmtMoneyShort, num } from "@/lib/format";
import { addDays, addHours, startOfLocalDay } from "@/lib/tz";
import { Alert, Card, CardHeader, ExportLinks, Kpi, LinkButton, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { BarChartView } from "@/components/charts";
import { EPS } from "@/server/services/inventory";
import { localDateKey, addDaysKey } from "@/lib/tz";
import { recordRetailReturnAction, recordSaleAction } from "../actions";
import { LotActions } from "../../inventory/lot-actions";

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "retail.view" });
  const { id } = await params;
  const now = new Date();
  const today = startOfLocalDay(now, ctx.tz);
  const data = await withTenant(ctx, async (tx) => {
    const loc = await tx.retailLocation.findUnique({ where: { id }, include: { warehouse: { include: { chambers: true } } } });
    if (!loc) return null;
    const todayKey = localDateKey(now, ctx.tz);
    const [lots, salesToday, byProduct, cashiers, recentSales, products, sold7] = await Promise.all([
      tx.inventory.findMany({ where: { warehouseId: loc.warehouseId, quantityKg: { gt: EPS } }, include: { product: true, batch: true }, orderBy: { expiryDate: "asc" } }),
      tx.sale.aggregate({ where: { retailLocationId: id, soldAt: { gte: today } }, _sum: { total: true, quantityKg: true }, _count: true }),
      tx.sale.groupBy({ by: ["productId"], where: { retailLocationId: id, soldAt: { gte: addDays(today, -6) } }, _sum: { total: true, quantityKg: true }, orderBy: { _sum: { total: "desc" } } }),
      tx.sale.groupBy({ by: ["cashierName"], where: { retailLocationId: id, soldAt: { gte: today } }, _sum: { total: true, quantityKg: true }, _count: true }),
      tx.sale.findMany({ where: { retailLocationId: id }, include: { product: true }, orderBy: { soldAt: "desc" }, take: 25 }),
      tx.product.findMany({ where: { isActive: true }, select: { id: true, name: true, price: true, sku: true } }),
      tx.sale.groupBy({ by: ["productId"], where: { retailLocationId: id, soldAt: { gte: addDays(today, -7) }, type: "SALE" }, _sum: { quantityKg: true } }),
    ]);
    const days = await tx.$queryRaw<{ day: string; v: number }[]>`
      SELECT to_char(("soldAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.tz}, 'YYYY-MM-DD') AS day, SUM(total)::float AS v FROM sales
      WHERE "retailLocationId" = ${id} AND "soldAt" >= ${addDays(today, -13)} GROUP BY 1 ORDER BY 1`;
    const keys: string[] = [];
    for (let i = 13; i >= 0; i--) keys.push(addDaysKey(todayKey, -i));
    return { loc, lots, salesToday, byProduct, cashiers, recentSales, products, sold7, chart: keys.map((k) => ({ day: k, sales: Math.round(days.find((d) => d.day === k)?.v ?? 0) })) };
  });
  if (!data) notFound();
  const { loc, lots } = data;
  const t = ctx.t;
  const pName = new Map(data.products.map((p) => [p.id, p.name]));
  const valid = lots.filter((l) => l.expiryDate > now);
  const stockByProduct = new Map<string, { name: string; kg: number; lots: number; nextExpiry: Date }>();
  for (const l of valid) {
    const e = stockByProduct.get(l.productId) ?? { name: l.product.name, kg: 0, lots: 0, nextExpiry: l.expiryDate };
    e.kg += l.quantityKg;
    e.lots++;
    if (l.expiryDate < e.nextExpiry) e.nextExpiry = l.expiryDate;
    stockByProduct.set(l.productId, e);
  }
  // low stock: products sold in the last 7 days whose remaining stock covers less than one average day
  const low = data.sold7
    .map((s) => ({ productId: s.productId, avg: (s._sum.quantityKg ?? 0) / 7, kg: stockByProduct.get(s.productId)?.kg ?? 0 }))
    .filter((x) => x.avg > 0.5 && x.kg < x.avg);
  const expiring = valid.filter((l) => l.expiryDate < addHours(now, 24));
  const expired = lots.filter((l) => l.expiryDate <= now);
  const canOp = ctx.can("retail.operate");
  const saleProducts = [...stockByProduct.entries()].map(([pid, s]) => ({ value: pid, label: `${s.name} — ${s.kg.toFixed(1)} kg` }));
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Retail Locations"), href: "/app/retail" }, { label: loc.code }]}
        title={loc.name}
        description={`${loc.address ?? ""} · ${t("Manager")}: ${loc.managerName ?? "—"} · POS: ${loc.posProvider ? `${loc.posProvider.toUpperCase()} (${t("not connected")})` : t("manual entry")}`}
        actions={
          <>
            <ExportLinks report="sales" query={`location=${loc.id}`} />
            {ctx.can("inventory.operate") && <LinkButton href="/app/inventory/transfers">{t("Replenish (transfer)")}</LinkButton>}
            {canOp && (
              <Modal trigger={t("Record return")} title="Customer return at store">
                <ActionForm action={recordRetailReturnAction} className="space-y-3">
                  <Hidden name="retailLocationId" value={loc.id} />
                  <SelectInput name="productId" label="Product" required placeholder="" options={data.recentSales.filter((s) => s.type === "SALE").map((s) => ({ value: s.productId, label: s.product.name })).filter((o, i, a) => a.findIndex((x) => x.value === o.value) === i)} />
                  <SelectInput name="batchId" label="Batch (from label)" required placeholder="" options={[...new Map(data.recentSales.map((s) => [s.batchId, s])).values()].map((s) => ({ value: s.batchId, label: `${s.product.name} · ${fmtDateTime(s.soldAt, ctx.tz)}` }))} />
                  <NumberInput name="quantityKg" label="Quantity" required suffix="kg" />
                  <TextInput name="reason" label="Reason" required />
                  <p className="text-[12px] text-ink-3">{t("Returned food is written off and the sale is reversed.")}</p>
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Record return</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
            {canOp && (
              <Modal trigger={t("Record sale")} title="Record sale" triggerVariant="primary">
                <ActionForm action={recordSaleAction} className="space-y-3" resetOnSuccess closeOnSuccess={false}>
                  <Hidden name="retailLocationId" value={loc.id} />
                  <SelectInput name="productId" label="Product (in store stock)" required placeholder="" options={saleProducts} />
                  <div className="grid grid-cols-2 gap-3">
                    <NumberInput name="quantityKg" label="Quantity" required suffix="kg" />
                    <NumberInput name="unitPrice" label="Price per kg (default list price)" suffix="UZS" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <TextInput name="cashierName" label="Cashier" />
                    <TextInput name="receiptNo" label="Receipt no." />
                  </div>
                  <p className="text-[12px] text-ink-3">{t("Stock is consumed FEFO — the earliest-expiring store lot first. Expired stock cannot be sold.")}</p>
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Save sale</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      {expired.length > 0 && <Alert tone="critical" className="mb-4" title={t("{n} expired lot(s) in this store", { n: expired.length })}>{t("Remove them from sale and write them off.")}</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t("Sales today")} value={fmtMoneyShort(num(data.salesToday._sum.total), ctx.tenant.currency)} sub={fmtKg(data.salesToday._sum.quantityKg ?? 0, 1)} />
        <Kpi label={t("Sale lines today")} value={String(data.salesToday._count)} />
        <Kpi label={t("Store stock")} value={fmtKg(valid.reduce((s, l) => s + l.quantityKg, 0), 1)} sub={t("{n} lots", { n: valid.length })} />
        <Kpi label={t("Low stock items")} value={String(low.length)} tone={low.length ? "warning" : "good"} />
        <Kpi label={t("Expiring ≤ 24 h")} value={fmtKg(expiring.reduce((s, l) => s + l.quantityKg, 0), 1)} tone={expiring.length ? "warning" : "default"} />
      </div>
      {low.length > 0 && (
        <Alert tone="warning" className="mt-4" title={t("Low stock")}>
          {low.map((x) => `${pName.get(x.productId)} (${x.kg.toFixed(1)} kg, ${t("avg")} ${x.avg.toFixed(1)} kg/${t("day")})`).join(" · ")}
        </Alert>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Daily sales")} description={`${t("Last 14 days")} · ${ctx.tenant.currency}`} />
          <BarChartView data={data.chart} xKey="day" series={[{ key: "sales", label: "Sales" }]} unit={ctx.tenant.currency} digits={0} height={220} />
        </Card>
        <Card>
          <CardHeader title={t("Sales by product — 7 days")} />
          <SimpleTable head={[t("Product"), t("kg"), t("Revenue")]}>
            {data.byProduct.slice(0, 10).map((b) => (
              <tr key={b.productId}>
                <td className="td">{pName.get(b.productId)}</td>
                <td className="td tabular">{(b._sum.quantityKg ?? 0).toFixed(1)}</td>
                <td className="td tabular">{fmtMoney(b._sum.total)}</td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title={t("Store inventory (FEFO)")} />
          <SimpleTable head={[t("Product"), t("Batch"), t("Expires"), t("Quantity"), t("Status"), ""]}>
            {lots.map((l) => (
              <tr key={l.id}>
                <td className="td">{l.product.name}</td>
                <td className="td"><Link href={`/app/traceability/${l.batchId}`} className="font-mono text-[11.5px] text-navy-700 hover:underline">{l.batch.code}</Link></td>
                <td className={`td whitespace-nowrap text-[12.5px] ${l.expiryDate <= now ? "font-medium text-red-700" : l.expiryDate < addHours(now, 24) ? "text-amber-700" : ""}`}>{fmtDateTime(l.expiryDate, ctx.tz)}</td>
                <td className="td tabular">{fmtKg(l.quantityKg, 2)}</td>
                <td className="td"><StatusBadge status={l.expiryDate <= now ? "EXPIRED" : l.status} /></td>
                <td className="td">
                  <LotActions ctx={ctx} warehouses={[]} lot={{ id: l.id, quantityKg: l.quantityKg, reservedKg: l.reservedKg, status: l.status, productName: l.product.name, batchCode: l.batch.code, storageType: l.product.storageType, warehouseId: l.warehouseId }} />
                </td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Cashier activity — today")} />
            <SimpleTable head={[t("Cashier"), t("Lines"), t("kg"), t("Revenue")]}>
              {data.cashiers.map((c) => (
                <tr key={c.cashierName ?? "-"}>
                  <td className="td">{c.cashierName ?? "—"}</td>
                  <td className="td tabular">{c._count}</td>
                  <td className="td tabular">{(c._sum.quantityKg ?? 0).toFixed(1)}</td>
                  <td className="td tabular">{fmtMoney(c._sum.total)}</td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <Card>
            <CardHeader title={t("Recent sales")} />
            <ul className="space-y-1.5 text-[12.5px]">
              {data.recentSales.map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span className="truncate">{s.type === "RETURN" && <Pill tone="red">{t("Return")}</Pill>} {s.product.name}</span>
                  <span className="shrink-0 tabular text-ink-3">{s.quantityKg.toFixed(2)} kg · {fmtMoney(s.total)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
