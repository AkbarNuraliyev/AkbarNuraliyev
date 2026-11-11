import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg } from "@/lib/format";
import { ExportLinks, PageHeader, Pill } from "@/components/ui/basic";
import { DataTable, listParams, qs, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, RangeFilter, SearchBox, Toolbar } from "@/components/ui/controls";
import { parseRange, rangeBounds } from "@/server/services/analytics";
import { InventoryTabs } from "../tabs";

const TYPES = ["PRODUCTION_IN", "TRANSFER_OUT", "TRANSFER_IN", "SHIPMENT", "SALE", "RETURN", "ADJUSTMENT", "WRITE_OFF", "DAMAGE", "EXPIRED", "STOCKTAKE", "BLOCK", "UNBLOCK"];

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "inventory.view" });
  const sp = await searchParams;
  const range = parseRange(sp, ctx.tz, new Date(), "7d");
  const { from, to } = rangeBounds(range);
  const lp = listParams(sp, { defaultSort: "createdAt", sortable: ["createdAt", "quantityKg", "type"], pageSize: 50 });
  const type = spGet(sp, "type");
  const wh = spGet(sp, "warehouse");
  const data = await withTenant(ctx, async (tx) => {
    const products = lp.q ? await tx.product.findMany({ where: { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { sku: { contains: lp.q, mode: "insensitive" } }] }, select: { id: true } }) : [];
    const where: Prisma.InventoryMovementWhereInput = {
      createdAt: { gte: from, lt: to },
      ...(type ? { type: type as "SALE" } : {}),
      ...(wh ? { warehouseId: wh } : {}),
      ...(lp.q ? { OR: [{ batch: { code: { contains: lp.q, mode: "insensitive" } } }, { productId: { in: products.map((p) => p.id) } }, { reason: { contains: lp.q, mode: "insensitive" } }] } : {}),
    };
    const [rows, total, prods, whs] = await Promise.all([
      tx.inventoryMovement.findMany({ where, include: { batch: true }, orderBy: { [lp.sort]: lp.dir }, skip: lp.skip, take: lp.take }),
      tx.inventoryMovement.count({ where }),
      tx.product.findMany({ select: { id: true, name: true, sku: true } }),
      tx.warehouse.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return { rows, total, prods, whs };
  });
  const t = ctx.t;
  const pMap = new Map(data.prods.map((p) => [p.id, p]));
  const wMap = new Map(data.whs.map((w) => [w.id, w.name]));
  return (
    <>
      <PageHeader title={t("Inventory & Warehouses")} description={t("Complete, immutable history of every stock movement with user and reference.")} actions={<ExportLinks report="movements" query={qs(sp, { page: null, q: null, sort: null, dir: null })} />} />
      <InventoryTabs current="movements" t={t} />
      <Toolbar>
        <RangeFilter options={["today", "7d", "30d"]} />
      </Toolbar>
      <Toolbar>
        <SearchBox placeholder="Batch, product, reason…" />
        <FilterSelect param="type" label="Type" options={TYPES.map((x) => ({ value: x, label: x.replaceAll("_", " ").toLowerCase() }))} />
        <FilterSelect param="warehouse" label="Location" translate={false} options={data.whs.map((w) => ({ value: w.id, label: w.name }))} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/inventory/movements"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        dense
        columns={[
          { key: "at", header: "Time", sortKey: "createdAt", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt, ctx.tz)}</span> },
          { key: "type", header: "Type", sortKey: "type", render: (r) => <Pill tone={r.quantityKg > 0 ? "green" : r.quantityKg < 0 ? (["WRITE_OFF", "DAMAGE", "EXPIRED"].includes(r.type) ? "red" : "gray") : "amber"}>{t(r.type.replaceAll("_", " ").toLowerCase())}</Pill> },
          { key: "p", header: "Product", render: (r) => pMap.get(r.productId)?.name ?? "—" },
          { key: "b", header: "Batch", render: (r) => <Link href={`/app/traceability/${r.batchId}`} className="font-mono text-[12px] text-navy-700 hover:underline">{r.batch.code}</Link> },
          { key: "w", header: "Location", render: (r) => wMap.get(r.warehouseId) ?? "—" },
          { key: "q", header: "Quantity", sortKey: "quantityKg", align: "right", render: (r) => <span className={r.quantityKg < 0 ? "text-red-700" : r.quantityKg > 0 ? "text-brand-700" : ""}>{r.quantityKg > 0 ? "+" : ""}{fmtKg(r.quantityKg, 3)}</span> },
          { key: "r", header: "Reason / reference", render: (r) => <span className="text-[12.5px] text-ink-2">{r.reason ?? r.referenceType ?? "—"}</span> },
        ]}
      />
    </>
  );
}
