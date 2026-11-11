import Link from "@/components/ui/link";
import { Plus, Printer } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtMoney } from "@/lib/format";
import { Card, CardHeader, PageHeader, Pill, LinkButton } from "@/components/ui/basic";
import { SimpleTable, spGet, type SP } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, Checkbox, FormActions, FormError, NumberInput, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { EPS } from "@/server/services/inventory";
import { createLabelsAction, createTemplateAction } from "../actions";
import { ProductTabs } from "../tabs";

export default async function LabelsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "products.view" });
  const sp = await searchParams;
  const lotParam = spGet(sp, "lot");
  const now = new Date();
  const data = await withTenant(ctx, async (tx) => {
    const [labels, templates, lots] = await Promise.all([
      tx.label.findMany({ include: { product: true, batch: true, template: true }, orderBy: { printedAt: "desc" }, take: 60 }),
      tx.labelTemplate.findMany({ orderBy: { createdAt: "asc" } }),
      tx.inventory.findMany({
        where: { quantityKg: { gt: EPS }, status: { not: "BLOCKED" }, expiryDate: { gt: now }, warehouse: { type: { not: "RETAIL" } } },
        include: { product: true, batch: true, warehouse: true },
        orderBy: [{ createdAt: "desc" }],
        take: 150,
      }),
    ]);
    return { labels, templates, lots };
  });
  const t = ctx.t;
  const canOperate = ctx.can("products.operate");
  return (
    <>
      <PageHeader
        title={t("Products & Labels")}
        description={t("Variable-weight labels pull product, batch, dates and price from the database. Barcode: EAN-13 '22' + PLU + weight in grams.")}
        actions={
          <>
            {ctx.can("products.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New template")}</>} title="New label template">
                <ActionForm action={createTemplateAction} className="space-y-4">
                  <TextInput name="name" label="Template name" required />
                  <div className="grid grid-cols-2 gap-3">
                    <NumberInput name="widthMm" label="Width (mm)" required step={1} defaultValue={58} />
                    <NumberInput name="heightMm" label="Height (mm)" required step={1} defaultValue={40} />
                  </div>
                  <SelectInput name="layout" label="Layout" defaultValue="STANDARD" translateOptions options={[{ value: "COMPACT", label: "Compact" }, { value: "STANDARD", label: "Standard" }, { value: "LARGE", label: "Large" }]} />
                  <Checkbox name="showPrice" label="Show price" defaultChecked />
                  <Checkbox name="showQr" label="Show QR code (public traceability page)" defaultChecked />
                  <Checkbox name="showBarcode" label="Show EAN-13 barcode" defaultChecked />
                  <FormError />
                  <FormActions><SubmitButton>Create template</SubmitButton></FormActions>
                </ActionForm>
              </Modal>
            )}
            {canOperate && (
              <Modal trigger={<><Printer className="h-4 w-4" />{t("Generate labels")}</>} title="Generate labels" size="lg" triggerVariant="primary">
                <ActionForm action={createLabelsAction} className="space-y-4">
                  <SelectInput
                    name="inventoryId"
                    label="Stock lot (product · batch · location)"
                    required
                    placeholder=""
                    defaultValue={lotParam}
                    options={data.lots.map((l) => ({ value: l.id, label: `${l.product.name} · ${l.batch.code} · ${l.warehouse.name} · ${l.quantityKg.toFixed(1)} kg` }))}
                  />
                  <SelectInput name="templateId" label="Template" defaultValue={data.templates.find((x) => x.isDefault)?.id} options={data.templates.map((x) => ({ value: x.id, label: `${x.name} (${x.widthMm}×${x.heightMm} mm)` }))} />
                  <TextArea name="weights" label="Pack weights (kg)" required rows={4} placeholder="1.245 1.180 1.302 — or 20x0.5 for fixed-weight packs" hint="One label per weight. Separate with spaces, commas or new lines. Use 20x0.5 for 20 packs of 0.5 kg." />
                  <NumberInput name="copies" label="Copies per label" step={1} defaultValue={1} min={1} max={10} />
                  <FormError />
                  <FormActions><SubmitButton>Generate and print</SubmitButton></FormActions>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      <ProductTabs current="labels" t={t} />
      <Card className="mb-4">
        <CardHeader title={t("Label templates")} description={t("Printing-ready layouts; print at 100% scale on thermal label printers.")} />
        <div className="grid gap-3 sm:grid-cols-3">
          {data.templates.map((x) => (
            <div key={x.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{x.name}</span>
                {x.isDefault && <Pill tone="green">{t("Default")}</Pill>}
              </div>
              <div className="mt-1 text-[12.5px] text-ink-3">
                {x.widthMm} × {x.heightMm} mm · {t(x.layout.charAt(0) + x.layout.slice(1).toLowerCase())} · {[x.showPrice && t("price"), x.showQr && "QR", x.showBarcode && "EAN-13"].filter(Boolean).join(", ")}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title={t("Recently generated labels")} />
        <SimpleTable head={[t("Serial"), t("Product"), t("Batch"), t("Net weight"), t("Price"), t("Produced"), t("Expires"), t("Barcode"), ""]}>
          {data.labels.map((l) => (
            <tr key={l.id}>
              <td className="td font-mono text-[12.5px]">{l.serial}</td>
              <td className="td">{l.product.name}</td>
              <td className="td"><Link href={`/app/traceability/${l.batchId}`} className="font-mono text-[12px] text-navy-700 hover:underline">{l.batch.code}</Link></td>
              <td className="td tabular">{fmtKg(l.netWeightKg, 3)}</td>
              <td className="td tabular">{l.totalPrice ? fmtMoney(l.totalPrice) : "—"}</td>
              <td className="td whitespace-nowrap">{fmtDateTime(l.productionDate, ctx.tz)}</td>
              <td className="td whitespace-nowrap">{fmtDateTime(l.expiryDate, ctx.tz)}</td>
              <td className="td font-mono text-[12px]">{l.barcode}</td>
              <td className="td"><LinkButton href={`/print/labels?ids=${l.id}`} size="sm" target="_blank">{t("Print")}</LinkButton></td>
            </tr>
          ))}
        </SimpleTable>
      </Card>
    </>
  );
}
