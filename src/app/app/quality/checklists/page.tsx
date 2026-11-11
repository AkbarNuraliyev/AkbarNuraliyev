import Link from "@/components/ui/link";
import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { Card, CardHeader, PageHeader, Pill } from "@/components/ui/basic";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import type { ChecklistItem } from "@/server/services/quality";
import { createChecklistAction } from "../actions";
import { QualityTabs } from "../tabs";

export default async function ChecklistsPage() {
  const ctx = await requireApp({ permission: "quality.view" });
  const lists = await withTenant(ctx, (tx) => tx.qualityChecklist.findMany({ include: { _count: { select: { records: true } } }, orderBy: [{ type: "asc" }, { name: "asc" }] }));
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Quality Control")}
        description={t("Configurable inspection checklists. Items marked CCP fail the record when out of limits.")}
        actions={
          ctx.can("quality.manage") && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("Checklist")}</>} title="New checklist" size="lg" triggerVariant="primary">
              <ActionForm action={createChecklistAction} className="space-y-3">
                <TextInput name="name" label="Name" required />
                <SelectInput name="type" label="Type" defaultValue="HACCP" options={["HACCP", "SANITATION", "RECEIVING", "PRODUCTION", "TEMPERATURE", "GENERAL"].map((x) => ({ value: x, label: x }))} />
                <TextInput name="description" label="Description" />
                <TextArea name="items" label="Items (one per line)" required rows={6} placeholder={"Carcass core temperature (°C) | number | | 4 | ccp\nHand-wash stations stocked | bool"} hint="Format: label | bool / number / text | min | max | ccp" />
                <FormError />
                <div className="flex justify-end"><SubmitButton>Create checklist</SubmitButton></div>
              </ActionForm>
            </Modal>
          )
        }
      />
      <QualityTabs current="checklists" t={t} />
      <div className="grid gap-4 lg:grid-cols-2">
        {lists.map((l) => (
          <Card key={l.id}>
            <CardHeader
              title={l.name}
              description={l.description ?? undefined}
              actions={
                <>
                  <Pill>{l.type}</Pill>
                  {ctx.can("quality.operate") && <Link href={`/app/quality/records/new?checklist=${l.id}`} className="link text-[13px]">{t("Start")}</Link>}
                </>
              }
            />
            <ul className="space-y-1 text-[13px]">
              {(l.items as unknown as ChecklistItem[]).map((it) => (
                <li key={it.id} className="flex items-center gap-2">
                  <span className="text-ink-3">•</span>
                  <span>{t(it.label)}</span>
                  {it.critical && <Pill tone="red">CCP</Pill>}
                  {(it.min !== undefined || it.max !== undefined) && <span className="text-[12px] text-ink-3">[{it.min ?? "—"} … {it.max ?? "—"}]</span>}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[12px] text-ink-3">{t("{n} records", { n: l._count.records })} · v{l.version}</div>
          </Card>
        ))}
      </div>
    </>
  );
}
