import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { Card, PageHeader, Pill } from "@/components/ui/basic";
import { ActionForm, FormError, Hidden, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { spGet, type SP } from "@/components/ui/table";
import type { ChecklistItem } from "@/server/services/quality";
import { recordQualityAction } from "../../actions";

export default async function NewInspection({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "quality.operate" });
  const sp = await searchParams;
  const cl = await withTenant(ctx, (tx) => tx.qualityChecklist.findUnique({ where: { id: spGet(sp, "checklist") ?? "-" } }));
  if (!cl) notFound();
  const items = cl.items as unknown as ChecklistItem[];
  const t = ctx.t;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t("Quality Control"), href: "/app/quality" }, { label: t("New inspection") }]} title={cl.name} description={cl.description ?? undefined} />
      <Card className="max-w-3xl">
        <ActionForm action={recordQualityAction} className="space-y-4">
          <Hidden name="checklistId" value={cl.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput name="area" label="Area / line / chamber" required />
            <TextInput name="batchId" label="Batch ID (optional)" placeholder="SAFI-20261111-FARM001-0001" />
          </div>
          <div className="divide-y divide-line rounded-lg border border-line">
            {items.map((it) => (
              <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="text-sm">
                  {t(it.label)} {it.critical && <Pill tone="red">CCP</Pill>}
                  {(it.min !== undefined || it.max !== undefined) && <div className="text-[12px] text-ink-3">{t("Limit")}: {it.min ?? "—"} … {it.max ?? "—"}</div>}
                </div>
                {it.kind === "bool" ? (
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-1.5"><input type="radio" name={`r_${it.id}`} value="yes" required className="h-4 w-4 accent-brand-600" /> {t("Yes / compliant")}</label>
                    <label className="flex items-center gap-1.5"><input type="radio" name={`r_${it.id}`} value="no" className="h-4 w-4 accent-red-600" /> {t("No")}</label>
                  </div>
                ) : it.kind === "number" ? (
                  <input name={`r_${it.id}`} type="number" step="any" className="input h-10 w-32 text-right" inputMode="decimal" />
                ) : (
                  <input name={`r_${it.id}`} className="input h-10 w-64" />
                )}
              </div>
            ))}
          </div>
          <TextArea name="notes" label="Observations / corrective action taken" />
          <p className="text-[12px] text-ink-3">{t("Photos can be attached on the record page after saving. Records are timestamped and signed with your user account.")}</p>
          <FormError />
          <div className="flex justify-end"><SubmitButton size="lg">Save inspection</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
