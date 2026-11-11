import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtDay, fmtKg, fmtNum, fmtPct, fmtTime, round } from "@/lib/format";
import { Alert, Card, CardHeader, DescriptionList, Kpi, PageHeader, Pill, ProgressBar } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton } from "@/components/ui/form";
import { computeShiftMetrics, WASTE_CATEGORIES } from "@/server/services/production";
import { addInputAction, closeShiftAction, deleteOutputAction, reopenShiftAction } from "../../actions";
import { OutputForm } from "./output-form";

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "production.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const shift = await tx.productionShift.findUnique({
      where: { id },
      include: {
        line: true,
        facility: true,
        inputs: { include: { batch: { include: { farm: true, supplier: true } } }, orderBy: { createdAt: "asc" } },
        outputs: { include: { product: true }, orderBy: { producedAt: "desc" } },
      },
    });
    if (!shift) return null;
    const [available, products, warehouses] = await Promise.all([
      tx.productionBatch.findMany({ where: { status: { in: ["RECEIVED", "IN_PRODUCTION"] } }, include: { farm: true }, orderBy: { createdAt: "asc" }, take: 100 }),
      tx.product.findMany({ where: { isActive: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sku: "asc" }] }),
      tx.warehouse.findMany({ where: { isActive: true, type: { not: "RETAIL" } }, include: { chambers: { where: { isActive: true }, orderBy: { code: "asc" } } }, orderBy: { code: "asc" } }),
    ]);
    return { shift, available, products, warehouses };
  });
  if (!data) notFound();
  const { shift, available, products, warehouses } = data;
  const t = ctx.t;
  const m = computeShiftMetrics({ inputs: shift.inputs, outputs: shift.outputs, plannedInputKg: shift.plannedInputKg, plannedBirds: shift.plannedBirds, tolerancePct: ctx.settings.massBalanceTolerancePct });
  const open = shift.status === "OPEN";
  const canOperate = ctx.can("production.operate");
  const batchRows = shift.inputs.reduce<Record<string, { id: string; code: string; inputKg: number; outputKg: number }>>((acc, i) => {
    acc[i.batchId] = acc[i.batchId] ?? { id: i.batchId, code: i.batch.code, inputKg: 0, outputKg: 0 };
    acc[i.batchId].inputKg += i.inputWeightKg;
    return acc;
  }, {});
  for (const o of shift.outputs) if (batchRows[o.batchId]) batchRows[o.batchId].outputKg += o.weightKg;
  const productMap = new Map(products.map((p) => [p.id, p]));
  const saleableShare = m.inputKg ? (m.saleableKg / m.inputKg) * 100 : 0;
  const wasteShare = m.inputKg ? (m.wasteKg / m.inputKg) * 100 : 0;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Production / MES"), href: "/app/production" }, { label: shift.number }]}
        title={`${t("Shift")} ${shift.number}`}
        description={`${shift.line.name} · ${shift.facility.name} · ${fmtDay(shift.shiftDate)} · ${t(shift.shiftType.charAt(0) + shift.shiftType.slice(1).toLowerCase())}`}
        actions={
          <>
            <StatusBadge status={shift.status} />
            {open && canOperate && (
              <ActionButton action={closeShiftAction} fields={{ id: shift.id }} variant="primary" size="md" confirm="Close this shift?" confirmText="Yields are finalised and the mass balance is checked against the tolerance. Managers can re-open a shift if corrections are needed." confirmVariant="primary">
                Close shift
              </ActionButton>
            )}
            {!open && ctx.can("production.manage") && (
              <ActionButton action={reopenShiftAction} fields={{ id: shift.id }} size="md" reasonLabel="Reason for re-opening (audit log)" confirmVariant="primary">
                Re-open shift
              </ActionButton>
            )}
          </>
        }
      />
      {m.massBalanceFlag && (
        <Alert tone="warning" title={t("Unexplained mass difference")} className="mb-4">
          {t("{kg} kg ({pct}%) of the input is not accounted for by products, by-products or waste. Tolerance: {tol}%.", { kg: round(m.unexplainedKg, 1), pct: round(m.unexplainedPct, 2), tol: ctx.settings.massBalanceTolerancePct })}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("Input weight")} value={fmtKg(m.inputKg, 0)} sub={shift.plannedInputKg ? `${t("Plan")} ${fmtKg(shift.plannedInputKg, 0)} (${m.planInputVariancePct! >= 0 ? "+" : ""}${round(m.planInputVariancePct ?? 0, 1)}%)` : undefined} />
        <Kpi label={t("Birds processed")} value={fmtNum(m.birds)} sub={shift.plannedBirds ? `${t("Plan")} ${fmtNum(shift.plannedBirds)}` : m.birds ? `${t("avg")} ${m.avgBirdKg.toFixed(3)} kg` : undefined} />
        <Kpi label={t("Saleable output")} value={fmtKg(m.saleableKg, 0)} sub={`${t("Products")} ${fmtKg(m.productKg, 0)} · ${t("By-products")} ${fmtKg(m.byproductKg, 0)}`} />
        <Kpi label={t("Total yield")} value={m.inputKg ? fmtPct(m.totalYieldPct, 2) : "—"} tone="good" />
        <Kpi label={t("Waste")} value={m.inputKg ? fmtPct(m.wastePct, 2) : "—"} sub={fmtKg(m.wasteKg, 0)} />
        <Kpi label={t("Unexplained")} value={m.inputKg ? fmtPct(m.unexplainedPct, 2) : "—"} sub={fmtKg(m.unexplainedKg, 1)} tone={m.massBalanceFlag ? "warning" : "default"} />
      </div>
      <Card className="mt-4">
        <CardHeader title={t("Mass balance")} description={t("Input = saleable output + waste + unexplained difference")} />
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-[#2a78d6]" style={{ width: `${Math.min(100, saleableShare)}%` }} title={t("Saleable")} />
          <div className="h-full bg-[#98a2b3]" style={{ width: `${Math.min(100, wasteShare)}%` }} title={t("Waste")} />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[12.5px] text-ink-2">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2a78d6]" />{t("Saleable")} {fmtPct(saleableShare, 2)}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#98a2b3]" />{t("Waste")} {fmtPct(wasteShare, 2)}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />{t("Unexplained / pending")} {fmtPct(m.unexplainedPct, 2)}</span>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Input batches")} description={t("Live birds processed in this shift")} />
            <SimpleTable head={[t("Batch"), t("Farm / supplier"), t("Birds"), t("Input kg"), t("Outputs kg"), t("Yield"), t("Waste"), t("Remaining to record")]}>
              {m.byBatch.map((b) => {
                const inp = shift.inputs.find((i) => i.batchId === b.batchId)!;
                return (
                  <tr key={b.batchId}>
                    <td className="td"><Link href={`/app/traceability/${b.batchId}`} className="font-mono text-[12.5px] text-navy-700 hover:underline">{inp.batch.code}</Link></td>
                    <td className="td">{inp.batch.farm.code}<div className="text-[12px] text-ink-3">{inp.batch.supplier.name}</div></td>
                    <td className="td tabular">{fmtNum(b.birds)}</td>
                    <td className="td tabular">{fmtKg(b.inputKg, 1)}</td>
                    <td className="td tabular">{fmtKg(b.outputKg, 1)}</td>
                    <td className="td tabular">{b.inputKg ? fmtPct(b.yieldPct, 2) : "—"}</td>
                    <td className="td tabular">{b.inputKg ? fmtPct(b.wastePct, 2) : "—"}</td>
                    <td className="td w-40">
                      <div className="mb-1 text-[12px] tabular text-ink-3">{fmtKg(b.unexplainedKg, 1)}</div>
                      <ProgressBar value={b.outputKg} max={b.inputKg} />
                    </td>
                  </tr>
                );
              })}
              {m.byBatch.length === 0 && (
                <tr><td className="td text-center text-ink-3" colSpan={8}>{t("No input batches registered yet")}</td></tr>
              )}
            </SimpleTable>
          </Card>

          <Card>
            <CardHeader title={t("Product yields")} description={t("Product weight ÷ shift input weight × 100, compared with the product's target yield")} />
            <SimpleTable head={[t("Product"), t("Weight"), t("Yield"), t("Target"), t("Deviation")]}>
              {m.productYields
                .sort((a, b) => b.kg - a.kg)
                .map((py) => {
                  const p = productMap.get(py.productId);
                  const dev = p?.targetYieldPct ? py.yieldPct - p.targetYieldPct : null;
                  return (
                    <tr key={py.productId}>
                      <td className="td">{p?.name}<div className="text-[12px] text-ink-3">{p?.sku}</div></td>
                      <td className="td tabular">{fmtKg(py.kg, 1)}</td>
                      <td className="td tabular font-medium">{fmtPct(py.yieldPct, 2)}</td>
                      <td className="td tabular text-ink-3">{p?.targetYieldPct ? fmtPct(p.targetYieldPct, 1) : "—"}</td>
                      <td className="td tabular">{dev === null ? "—" : <span className={dev < 0 ? "text-amber-700" : "text-ink-2"}>{dev > 0 ? "+" : ""}{dev.toFixed(2)} p.p.</span>}</td>
                    </tr>
                  );
                })}
            </SimpleTable>
            <p className="mt-2 text-[12px] text-ink-3">{t("Target yields are relative to total live input; products made from only part of the birds (e.g. whole carcasses vs cut-up) naturally deviate.")}</p>
          </Card>

          <Card>
            <CardHeader title={t("Recorded outputs")} description={t("{n} records", { n: shift.outputs.length })} />
            <SimpleTable head={[t("Time"), t("Batch"), t("Type"), t("Product / category"), t("Weight"), t("Units"), ""]}>
              {shift.outputs.map((o) => (
                <tr key={o.id}>
                  <td className="td tabular">{fmtTime(o.producedAt, ctx.tz)}</td>
                  <td className="td font-mono text-[12px]">{batchRows[o.batchId]?.code.slice(-14)}</td>
                  <td className="td"><Pill tone={o.outputType === "WASTE" ? "gray" : o.outputType === "BYPRODUCT" ? "violet" : "blue"}>{t(o.outputType === "PRODUCT" ? "Product" : o.outputType === "BYPRODUCT" ? "By-product" : "Waste")}</Pill></td>
                  <td className="td">{o.product?.name ?? t(o.wasteCategory ?? "")}</td>
                  <td className="td tabular">{fmtKg(o.weightKg, 2)}</td>
                  <td className="td tabular">{o.units ?? "—"}</td>
                  <td className="td text-right">
                    {open && ctx.can("production.manage") && (
                      <ActionButton action={deleteOutputAction} fields={{ id: o.id }} variant="ghost" reasonLabel="Reason for deleting this output (audit log)" confirm="Delete output record?" confirmText="Stock created by this output is reversed. Not possible if it was already allocated or moved.">
                        Delete
                      </ActionButton>
                    )}
                  </td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <Card>
            <CardHeader title={t("Shift details")} />
            <DescriptionList
              cols={3}
              items={[
                { label: t("Supervisor"), value: shift.supervisorName },
                { label: t("Started"), value: fmtDateTime(shift.startedAt, ctx.tz) },
                { label: t("Closed"), value: fmtDateTime(shift.closedAt, ctx.tz) },
                { label: t("Notes"), value: shift.notes },
              ]}
            />
          </Card>
        </div>

        <aside className="space-y-4">
          {open && canOperate ? (
            <>
              <Card>
                <CardHeader title={t("Register input batch")} />
                {available.length === 0 ? (
                  <p className="text-[13px] text-ink-3">{t("No received batches waiting for processing.")}</p>
                ) : (
                  <ActionForm action={addInputAction} resetOnSuccess className="space-y-3">
                    <Hidden name="shiftId" value={shift.id} />
                    <SelectInput
                      name="batchId"
                      label="Batch"
                      required
                      placeholder=""
                      options={available.map((b) => ({ value: b.id, label: `${b.code} — ${b.birds - b.processedBirds} ${t("birds")}, ${round(b.liveWeightKg - b.processedKg, 1)} kg` }))}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <NumberInput name="birdsProcessed" label="Birds processed" required step={1} min={1} />
                      <NumberInput name="inputWeightKg" label="Input weight" required suffix="kg" />
                    </div>
                    <FormError />
                    <SubmitButton className="w-full">Add input</SubmitButton>
                  </ActionForm>
                )}
              </Card>
              {Object.keys(batchRows).length > 0 && (
                <Modal trigger={t("Record output")} title="Record output" triggerVariant="primary" triggerSize="lg" triggerClassName="w-full">
                  <OutputForm
                    shiftId={shift.id}
                    batches={Object.values(batchRows)}
                    products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, storageType: p.storageType, isByproduct: p.isByproduct, isVariableWeight: p.isVariableWeight, netWeightKg: p.netWeightKg }))}
                    warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, chambers: w.chambers.map((c) => ({ id: c.id, name: c.name, type: c.type })) }))}
                    wasteCategories={WASTE_CATEGORIES}
                  />
                </Modal>
              )}
            </>
          ) : (
            <Card>
              <p className="text-[13px] text-ink-3">{open ? t("You can view this shift. Recording requires the production operate permission.") : t("This shift is closed. Figures are final unless a manager re-opens it.")}</p>
            </Card>
          )}
          <Card>
            <CardHeader title={t("Formulas")} />
            <ul className="space-y-1.5 text-[12.5px] text-ink-2">
              <li>{t("Total Yield % = Saleable output ÷ Input weight × 100")}</li>
              <li>{t("Product Yield % = Product weight ÷ Input weight × 100")}</li>
              <li>{t("Waste % = Waste weight ÷ Input weight × 100")}</li>
              <li>{t("Unexplained = Input − Saleable − Waste")}</li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
