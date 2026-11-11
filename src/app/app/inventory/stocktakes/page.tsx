import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, type SP } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormActions, FormError, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { createStocktakeAction } from "../actions";
import { InventoryTabs } from "../tabs";

export default async function StocktakesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "inventory.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "createdAt", sortable: ["createdAt"] });
  const data = await withTenant(ctx, async (tx) => {
    const [rows, total, whs] = await Promise.all([
      tx.stocktake.findMany({ include: { _count: { select: { lines: true } } }, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
      tx.stocktake.count(),
      tx.warehouse.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
    ]);
    return { rows, total, whs };
  });
  const t = ctx.t;
  const whName = new Map(data.whs.map((w) => [w.id, w.name]));
  return (
    <>
      <PageHeader
        title={t("Inventory & Warehouses")}
        description={t("Physical stock counts. Variances are posted as STOCKTAKE movements when the count is completed.")}
        actions={
          ctx.can("inventory.operate") && (
            <Modal trigger={t("Start stocktake")} title="Start stocktake" triggerVariant="primary">
              <ActionForm action={createStocktakeAction} className="space-y-4">
                <SelectInput name="warehouseId" label="Warehouse / store" required placeholder="" options={data.whs.map((w) => ({ value: w.id, label: w.name }))} />
                <TextInput name="notes" label="Notes" />
                <p className="text-[12px] text-ink-3">{t("A snapshot of all lots in the location is taken now. Movements during counting are preserved.")}</p>
                <FormError />
                <FormActions><SubmitButton>Start</SubmitButton></FormActions>
              </ActionForm>
            </Modal>
          )
        }
      />
      <InventoryTabs current="stocktakes" t={t} />
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/inventory/stocktakes"
        params={lp}
        total={data.total}
        rows={data.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/inventory/stocktakes/${r.id}`}
        columns={[
          { key: "n", header: "Stocktake", render: (r) => r.number },
          { key: "w", header: "Location", render: (r) => whName.get(r.warehouseId) },
          { key: "c", header: "Started", render: (r) => fmtDateTime(r.createdAt, ctx.tz) },
          { key: "d", header: "Completed", render: (r) => fmtDateTime(r.completedAt, ctx.tz) },
          { key: "l", header: "Lines", align: "right", render: (r) => r._count.lines },
          { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </>
  );
}
