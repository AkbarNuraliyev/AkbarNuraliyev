import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { spGet, type SP } from "@/components/ui/table";
import { EPS } from "@/server/services/inventory";
import { InventoryTabs } from "../tabs";
import { LotActions } from "../lot-actions";

/** Mobile-friendly lookup for warehouse staff: scan or type a batch ID, label serial or barcode. */
export default async function ScanPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "inventory.view" });
  const sp = await searchParams;
  const code = spGet(sp, "code")?.trim();
  const now = new Date();
  const data = code
    ? await withTenant(ctx, async (tx) => {
        const label = await tx.label.findFirst({ where: { OR: [{ serial: code }, { barcode: code }] }, orderBy: { printedAt: "desc" } });
        const batch = await tx.productionBatch.findFirst({ where: { OR: [{ code: { equals: code, mode: "insensitive" } }, { id: label?.batchId ?? "-" }, { publicToken: code }] } });
        if (!batch) return null;
        const [lots, whs] = await Promise.all([
          tx.inventory.findMany({ where: { batchId: batch.id, quantityKg: { gt: EPS }, ...(label?.inventoryId ? {} : {}) }, include: { product: true, warehouse: true, chamber: true }, orderBy: { expiryDate: "asc" } }),
          tx.warehouse.findMany({ where: { isActive: true, type: { not: "RETAIL" } }, include: { chambers: { where: { isActive: true } } } }),
        ]);
        return { batch, lots, whs, label };
      })
    : null;
  const t = ctx.t;
  return (
    <>
      <PageHeader title={t("Inventory & Warehouses")} description={t("Scan a batch QR / label barcode with a handheld scanner or type the code.")} />
      <InventoryTabs current="scan" t={t} />
      <form className="mb-4 flex gap-2" action="/app/inventory/scan">
        <input name="code" defaultValue={code} autoFocus className="input h-12 text-base" placeholder={t("Batch ID, label serial or EAN-13…")} inputMode="text" />
        <button className="h-12 shrink-0 rounded-md bg-navy-900 px-5 text-sm font-semibold text-white">{t("Find")}</button>
      </form>
      {code && !data && <EmptyState title={t("Nothing found for {code}", { code })} description={t("Check the code and try again.")} />}
      {data && (
        <div className="space-y-3">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[12px] text-ink-3">{t("Batch")}</div>
                <Link href={`/app/traceability/${data.batch.id}`} className="font-mono text-base font-semibold text-navy-700 hover:underline">{data.batch.code}</Link>
              </div>
              <StatusBadge status={data.batch.status} />
            </div>
            {data.label && <div className="mt-2 text-[13px] text-ink-3">{t("Label")} {data.label.serial} · {fmtKg(data.label.netWeightKg, 3)}</div>}
          </Card>
          {data.lots.map((l) => (
            <Card key={l.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{l.product.name}</div>
                <div className="text-[13px] text-ink-3">{l.warehouse.name}{l.chamber ? ` / ${l.chamber.name}` : ""}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-[13px]">
                  <span className="tabular font-semibold">{fmtKg(l.quantityKg, 2)}</span>
                  <span className={l.expiryDate < now ? "text-red-700" : "text-ink-2"}>{t("Expires")} {fmtDateTime(l.expiryDate, ctx.tz)}</span>
                  <StatusBadge status={l.status} />
                </div>
              </div>
              <LotActions ctx={ctx} warehouses={data.whs.map((w) => ({ id: w.id, name: w.name, chambers: w.chambers.map((c) => ({ id: c.id, name: c.name, type: c.type })) }))} lot={{ id: l.id, quantityKg: l.quantityKg, reservedKg: l.reservedKg, status: l.status, productName: l.product.name, batchCode: data.batch.code, storageType: l.product.storageType, warehouseId: l.warehouseId }} />
            </Card>
          ))}
          {data.lots.length === 0 && <p className="text-[13px] text-ink-3">{t("No stock of this batch is currently held.")}</p>}
        </div>
      )}
    </>
  );
}
