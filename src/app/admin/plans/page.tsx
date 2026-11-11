import { requireSuperAdmin } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { num } from "@/lib/format";
import { FEATURES } from "@/lib/modules";
import { Card, CardHeader, PageHeader } from "@/components/ui/basic";
import { ActionForm, Checkbox, FormError, Hidden, NumberInput, SubmitButton, TextInput } from "@/components/ui/form";
import { updatePlanAction } from "../actions";

export default async function AdminPlans() {
  const { t } = await requireSuperAdmin();
  const plans = await withSystem((tx) => tx.plan.findMany({ include: { _count: { select: { subscriptions: true } } }, orderBy: { sortOrder: "asc" } }));
  return (
    <>
      <PageHeader title={t("Plans & pricing")} description={t("Prices, limits and features per plan. Changes apply to all subscriptions on the plan and to the public pricing page. Empty limit = unlimited.")} />
      <div className="grid gap-4 xl:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader title={`${p.code}`} description={t("{n} subscriptions", { n: p._count.subscriptions })} />
            <ActionForm action={updatePlanAction} className="space-y-3">
              <Hidden name="id" value={p.id} />
              <TextInput name="name" label="Name" required defaultValue={p.name} />
              <TextInput name="description" label="Description" defaultValue={p.description} />
              <div className="grid grid-cols-2 gap-3">
                <NumberInput name="priceMonthly" label="Monthly (UZS)" required defaultValue={num(p.priceMonthly)} step={1000} />
                <NumberInput name="priceYearly" label="Yearly (UZS)" required defaultValue={num(p.priceYearly)} step={1000} />
                <NumberInput name="maxUsers" label="Max users" defaultValue={p.maxUsers} step={1} />
                <NumberInput name="maxFacilities" label="Max facilities" defaultValue={p.maxFacilities} step={1} />
                <NumberInput name="maxWarehouses" label="Max warehouses" defaultValue={p.maxWarehouses} step={1} />
                <NumberInput name="maxRetailLocations" label="Max retail locations" defaultValue={p.maxRetailLocations} step={1} />
                <NumberInput name="trialDays" label="Trial days" required defaultValue={p.trialDays} step={1} />
              </div>
              <div className="rounded-lg border border-line p-2">
                <div className="mb-1 text-[12px] font-medium text-ink-2">{t("Features")}</div>
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {FEATURES.map((f) => <Checkbox key={f.key} name={`feat_${f.key}`} label={f.label} defaultChecked={p.features.includes(f.key)} />)}
                </div>
              </div>
              <Checkbox name="isActive" label="Active (available for sign-up and changes)" defaultChecked={p.isActive} />
              <Checkbox name="isPublic" label="Shown on public pricing page" defaultChecked={p.isPublic} />
              <FormError />
              <SubmitButton className="w-full">Save plan</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
