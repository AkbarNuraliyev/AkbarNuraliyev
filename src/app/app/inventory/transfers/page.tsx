import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg } from "@/lib/format";
import { PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, type SP } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { EPS } from "@/server/services/inventory";
import { InventoryTabs } from "../tabs";
import { TransferForm } from "./transfer-form";

export default async function TransfersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "inventory.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "createdAt", sortable: ["createdAt"], pageSize: 30 });
  const now = new Date();
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, whs, lots] = await Promise.all([
      tx.stockTransfer.findMany({ include: { lines: true }, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
      tx.stockTransfer.count(),
      tx.warehouse.findMany({ where: { isActive: true }, include: { chambers: { where: { isActive: true } } }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
      tx.inventory.findMany({ where: { quantityKg: { gt: EPS }, status: "AVAILABLE", expiryDate: { gt: now } }, include: { product: true, batch: true }, orderBy: { expiryDate: "asc" }, take: 2000 }),
    ]);
    return { rows, total, whs, lots };
  });
  const t = ctx.t;
  const whName = new Map(data.whs.map((w) => [w.id, w.name]));
  return (
    <>
      <PageHeader
        title={t("Inventory & Warehouses")}
        description={t("Stock transfers between warehouses, chambers and retail stores (FEFO lots are listed first).")}
        actions={
          ctx.can("inventory.operate") && (
            <Modal trigger={t("New transfer")} title="New stock transfer" size="xl" triggerVariant="primary">
              <TransferForm
                warehouses={data.whs.map((w) => ({ id: w.id, name: w.name, type: w.type, chambers: w.chambers.map((c) => ({ id: c.id, name: c.name, type: c.type })) }))}
                lots={data.lots.map((l) => ({ id: l.id, warehouseId: l.warehouseId, product: l.product.name, storageType: l.product.storageType, batch: l.batch.code, free: Math.max(0, l.quantityKg - l.reservedKg), expiry: l.expiryDate.toISOString() }))}
              />
            </Modal>
          )
        }
      />
      <InventoryTabs current="transfers" t={t} />
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/inventory/transfers"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        columns={[
          { key: "n", header: "Transfer", render: (r) => <span className="font-medium">{r.number}</span> },
          { key: "at", header: "Date", render: (r) => fmtDateTime(r.createdAt, ctx.tz) },
          { key: "from", header: "From", render: (r) => whName.get(r.fromWarehouseId) },
          { key: "to", header: "To", render: (r) => whName.get(r.toWarehouseId) },
          { key: "l", header: "Lines", align: "right", render: (r) => r.lines.length },
          { key: "kg", header: "Quantity", align: "right", render: (r) => fmtKg(r.lines.reduce((s, l) => s + l.quantityKg, 0), 1) },
          { key: "notes", header: "Notes", render: (r) => <span className="text-[12.5px] text-ink-3">{r.notes}</span> },
          { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </>
  );
}
