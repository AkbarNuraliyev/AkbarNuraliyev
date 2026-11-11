import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { ActionForm, FormError, Hidden, SubmitButton } from "@/components/ui/form";
import { saveCountsAction } from "../../actions";

export default async function StocktakeDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "inventory.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const st = await tx.stocktake.findUnique({ where: { id }, include: { lines: true } });
    if (!st) return null;
    const lots = await tx.inventory.findMany({ where: { id: { in: st.lines.map((l) => l.inventoryId) } }, include: { product: true, batch: true, chamber: true } });
    const wh = await tx.warehouse.findUnique({ where: { id: st.warehouseId } });
    return { st, lots, wh };
  });
  if (!data) notFound();
  const { st, lots, wh } = data;
  const t = ctx.t;
  const open = st.status === "OPEN" && ctx.can("inventory.operate");
  const lotMap = new Map(lots.map((l) => [l.id, l]));
  const lines = [...st.lines].sort((a, b) => (lotMap.get(a.inventoryId)?.product.name ?? "").localeCompare(lotMap.get(b.inventoryId)?.product.name ?? ""));
  const variance = st.lines.reduce((s, l) => s + (l.countedKg !== null ? l.countedKg - l.systemKg : 0), 0);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Stocktaking"), href: "/app/inventory/stocktakes" }, { label: st.number }]}
        title={`${t("Stocktake")} ${st.number}`}
        description={`${wh?.name} · ${fmtDateTime(st.createdAt, ctx.tz)}${st.completedAt ? ` → ${fmtDateTime(st.completedAt, ctx.tz)}` : ""}`}
        actions={<StatusBadge status={st.status} />}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <span>{t("Lines")}: <b>{st.lines.length}</b></span>
          <span>{t("Counted")}: <b>{st.lines.filter((l) => l.countedKg !== null).length}</b></span>
          <span>{t("Net variance")}: <b className={variance < 0 ? "text-red-700" : ""}>{fmtKg(variance, 3)}</b></span>
        </div>
      </Card>
      <ActionForm action={saveCountsAction}>
        <Hidden name="id" value={st.id} />
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-slate-50/70">
              <tr>{[t("Product"), t("Batch"), t("Chamber"), t("System kg"), t("Counted kg"), t("Variance")].map((h) => <th key={h} className="th">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => {
                const lot = lotMap.get(l.inventoryId);
                const v = l.countedKg !== null ? l.countedKg - l.systemKg : null;
                return (
                  <tr key={l.id}>
                    <td className="td">{lot?.product.name}</td>
                    <td className="td font-mono text-[12px]">{lot?.batch.code}</td>
                    <td className="td">{lot?.chamber?.name ?? "—"}</td>
                    <td className="td tabular">{l.systemKg.toFixed(3)}</td>
                    <td className="td">{open ? <input name={`c_${l.id}`} type="number" step="any" min={0} defaultValue={l.countedKg ?? ""} className="input h-8 w-28 py-1 text-right" /> : l.countedKg?.toFixed(3) ?? "—"}</td>
                    <td className={`td tabular ${v && v < 0 ? "text-red-700" : ""}`}>{v === null ? "—" : v.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {open && (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <FormError />
            <SubmitButton variant="secondary" name="intent" value="save">Save counts</SubmitButton>
            {ctx.can("inventory.manage") && <SubmitButton name="intent" value="complete">Complete and post variances</SubmitButton>}
          </div>
        )}
      </ActionForm>
    </>
  );
}
