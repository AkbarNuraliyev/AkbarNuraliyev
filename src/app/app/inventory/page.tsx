import Link from "@/components/ui/link";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtMoneyShort, fmtNum, fmtWeight, num } from "@/lib/format";
import { addHours } from "@/lib/tz";
import { Alert, Card, CardHeader, ExportLinks, Kpi, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, spGet, SimpleTable, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";
import { ActionButton } from "@/components/ui/dialog";
import { EPS } from "@/server/services/inventory";
import { InventoryTabs } from "./tabs";
import { LotActions } from "./lot-actions";
import { writeOffExpiredAction } from "./actions";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "inventory.view" });
  const sp = await searchParams;
  const now = new Date();
  const lp = listParams(sp, { defaultSort: "expiryDate", defaultDir: "asc", sortable: ["expiryDate", "quantityKg", "productionDate", "product.name", "warehouse.name"], pageSize: 50 });
  const wh = spGet(sp, "warehouse");
  const storage = spGet(sp, "storage");
  const expiring = spGet(sp, "expiring");
  const status = spGet(sp, "status");
  const product = spGet(sp, "product");
  const where: Prisma.InventoryWhereInput = {
    quantityKg: { gt: EPS },
    ...(wh ? { warehouseId: wh } : {}),
    ...(storage ? { product: { storageType: storage as "CHILLED" } } : {}),
    ...(product ? { productId: product } : {}),
    ...(status ? { status: status as "BLOCKED" } : {}),
    ...(expiring === "expired"
      ? { expiryDate: { lte: now } }
      : expiring
        ? { expiryDate: { gt: now, lte: addHours(now, Number(expiring) || 72) } }
        : {}),
    ...(lp.q ? { OR: [{ batch: { code: { contains: lp.q, mode: "insensitive" } } }, { product: { name: { contains: lp.q, mode: "insensitive" } } }, { product: { sku: { contains: lp.q, mode: "insensitive" } } }] } : {}),
  };
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, warehouses, products, all, minProducts] = await Promise.all([
      tx.inventory.findMany({ where, include: { product: true, batch: true, warehouse: true, chamber: true }, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take }),
      tx.inventory.count({ where }),
      tx.warehouse.findMany({ where: { isActive: true }, include: { chambers: { where: { isActive: true } } }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
      tx.product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.inventory.findMany({ where: { quantityKg: { gt: EPS } }, select: { quantityKg: true, reservedKg: true, expiryDate: true, status: true, unitCost: true, productId: true, warehouseId: true, product: { select: { storageType: true, costPerKg: true, price: true } } } }),
      tx.product.findMany({ where: { isActive: true, minStockKg: { gt: 0 } }, select: { id: true, name: true, sku: true, minStockKg: true } }),
    ]);
    return { rows, total, warehouses, products, all, minProducts };
  });
  const t = ctx.t;
  const valid = data.all.filter((l) => l.expiryDate > now);
  const sumKg = (xs: typeof data.all) => xs.reduce((s, l) => s + l.quantityKg, 0);
  const inH = (h: number) => valid.filter((l) => l.expiryDate <= addHours(now, h) && l.status !== "BLOCKED");
  const expired = data.all.filter((l) => l.expiryDate <= now);
  const valueCost = valid.reduce((s, l) => s + l.quantityKg * num(l.unitCost ?? l.product.costPerKg), 0);
  const valueSell = valid.reduce((s, l) => s + l.quantityKg * num(l.product.price), 0);
  const nonRetailIds = new Set(data.warehouses.filter((w) => w.type !== "RETAIL").map((w) => w.id));
  const below = data.minProducts
    .map((p) => {
      const free = valid.filter((l) => l.productId === p.id && l.status === "AVAILABLE" && nonRetailIds.has(l.warehouseId)).reduce((s, l) => s + l.quantityKg - l.reservedKg, 0);
      return { ...p, free };
    })
    .filter((p) => p.free < (p.minStockKg ?? 0));
  const byLocation = data.warehouses
    .map((w) => ({ w, kg: sumKg(valid.filter((l) => l.warehouseId === w.id)) }))
    .filter((x) => x.kg > 0);
  const lotWarehouses = data.warehouses.filter((w) => w.type !== "RETAIL").map((w) => ({ id: w.id, name: w.name, chambers: w.chambers.map((c) => ({ id: c.id, name: c.name, type: c.type })) }));
  const href = (p: Record<string, string>) => `/app/inventory?${new URLSearchParams(p).toString()}`;
  return (
    <>
      <PageHeader
        title={t("Inventory & Warehouses")}
        description={t("Stock by warehouse, chamber and batch. Allocation always follows FEFO — first expired, first out.")}
        actions={
          <>
            <ExportLinks report="inventory" />
            {ctx.can("inventory.manage") && expired.length > 0 && (
              <ActionButton action={writeOffExpiredAction} variant="danger" size="md" confirm="Write off all expired stock?" confirmText="Every unreserved lot past its expiry date is written off with movement type EXPIRED. This cannot be undone.">
                {`${t("Write off expired")} (${expired.length})`}
              </ActionButton>
            )}
          </>
        }
      />
      <InventoryTabs current="stock" t={t} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label={t("Current stock")} value={fmtWeight(sumKg(valid))} href="/app/inventory" />
        <Kpi label={t("Chilled stock")} value={fmtWeight(sumKg(valid.filter((l) => l.product.storageType === "CHILLED")))} href={href({ storage: "CHILLED" })} />
        <Kpi label={t("Frozen stock")} value={fmtWeight(sumKg(valid.filter((l) => l.product.storageType === "FROZEN")))} href={href({ storage: "FROZEN" })} />
        <Kpi label={t("Expiring ≤ 24 h")} value={fmtWeight(sumKg(inH(24)))} tone={inH(24).length ? "critical" : "default"} href={href({ expiring: "24" })} />
        <Kpi label={t("Expiring ≤ 48 h")} value={fmtWeight(sumKg(inH(48)))} tone={inH(48).length ? "warning" : "default"} href={href({ expiring: "48" })} />
        <Kpi label={t("Expiring ≤ 72 h")} value={fmtWeight(sumKg(inH(72)))} href={href({ expiring: "72" })} />
        <Kpi label={t("Expired in stock")} value={fmtWeight(sumKg(expired))} sub={t("{n} lots", { n: expired.length })} tone={expired.length ? "critical" : "good"} href={href({ expiring: "expired" })} />
        <Kpi label={t("Inventory valuation")} value={fmtMoneyShort(valueCost, ctx.tenant.currency)} sub={`${t("at selling price")} ${fmtMoneyShort(valueSell, ctx.tenant.currency)}`} />
      </div>
      {below.length > 0 && (
        <Alert tone="warning" className="mt-4" title={t("{n} product(s) below minimum stock", { n: below.length })}>
          {below.slice(0, 8).map((p, i) => (
            <span key={p.id}>
              {i > 0 && " · "}
              <Link href={href({ product: p.id })} className="underline">{p.name}</Link> ({fmtKg(p.free, 0)} / {fmtKg(p.minStockKg, 0)})
            </span>
          ))}
        </Alert>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Toolbar>
            <SearchBox placeholder="Batch ID, product, SKU…" />
            <FilterSelect param="warehouse" label="Location" translate={false} options={data.warehouses.map((w) => ({ value: w.id, label: w.name }))} />
            <FilterSelect param="storage" label="Storage" options={[{ value: "CHILLED", label: "Chilled" }, { value: "FROZEN", label: "Frozen" }]} />
            <FilterSelect param="expiring" label="Expiry" options={[{ value: "24", label: "≤ 24 h" }, { value: "48", label: "≤ 48 h" }, { value: "72", label: "≤ 72 h" }, { value: "expired", label: "Expired" }]} />
            <FilterSelect param="status" label="Status" options={[{ value: "AVAILABLE", label: "Available" }, { value: "BLOCKED", label: "Blocked" }, { value: "QUARANTINE", label: "Quarantine" }]} />
            <FilterSelect param="product" label="Product" translate={false} options={data.products.map((p) => ({ value: p.id, label: p.name }))} />
          </Toolbar>
          <DataTable
            t={t}
            sp={sp}
            basePath="/app/inventory"
            params={lp}
            total={data.total}
            rows={data.rows}
            rowKey={(r) => r.id}
            dense
            columns={[
              { key: "p", header: "Product", sortKey: "product.name", render: (r) => <><Link href={`/app/products/${r.productId}`} className="font-medium hover:underline">{r.product.name}</Link><div className="text-[11.5px] text-ink-3">{r.product.sku}</div></> },
              { key: "b", header: "Batch", render: (r) => <Link href={`/app/traceability/${r.batchId}`} className="font-mono text-[12px] text-navy-700 hover:underline">{r.batch.code}</Link> },
              { key: "l", header: "Location", sortKey: "warehouse.name", render: (r) => <>{r.warehouse.name}<div className="text-[11.5px] text-ink-3">{r.chamber?.name}</div></> },
              { key: "pd", header: "Produced", sortKey: "productionDate", render: (r) => <span className="whitespace-nowrap text-[12.5px]">{fmtDateTime(r.productionDate, ctx.tz)}</span> },
              {
                key: "e",
                header: "Expires",
                sortKey: "expiryDate",
                render: (r) => {
                  const h = (r.expiryDate.getTime() - now.getTime()) / 3600000;
                  return (
                    <span className="whitespace-nowrap text-[12.5px]">
                      {fmtDateTime(r.expiryDate, ctx.tz)}
                      <div>{h <= 0 ? <Pill tone="red">{t("Expired")}</Pill> : h <= 24 ? <Pill tone="red">{Math.ceil(h)} h</Pill> : h <= 72 ? <Pill tone="amber">{Math.ceil(h)} h</Pill> : <span className="text-[11.5px] text-ink-3">{Math.round(h / 24)} {t("days")}</span>}</div>
                    </span>
                  );
                },
              },
              { key: "q", header: "Quantity", sortKey: "quantityKg", align: "right", render: (r) => <>{fmtKg(r.quantityKg, 2)}{r.reservedKg > EPS && <div className="text-[11.5px] text-ink-3">{t("res.")} {fmtKg(r.reservedKg, 1)}</div>}</> },
              { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              {
                key: "a",
                header: "",
                render: (r) => (
                  <LotActions
                    ctx={ctx}
                    warehouses={lotWarehouses}
                    lot={{ id: r.id, quantityKg: r.quantityKg, reservedKg: r.reservedKg, status: r.status, productName: r.product.name, batchCode: r.batch.code, storageType: r.product.storageType, warehouseId: r.warehouseId }}
                  />
                ),
              },
            ]}
          />
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title={t("Stock by location")} description={t("not expired")} />
            <SimpleTable head={[t("Location"), t("kg")]}>
              {byLocation.map(({ w, kg }) => (
                <tr key={w.id}>
                  <td className="td"><Link href={href({ warehouse: w.id })} className="link">{w.name}</Link><div className="text-[11.5px] text-ink-3">{t(w.type === "RETAIL" ? "Retail store" : w.type === "FACTORY" ? "Factory" : "Distribution")}</div></td>
                  <td className="td tabular">{fmtNum(kg, 0)}</td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
        </aside>
      </div>
    </>
  );
}
