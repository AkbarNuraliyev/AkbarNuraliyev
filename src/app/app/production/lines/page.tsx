import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { Card, CardHeader, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, NumberInput, SelectInput, SubmitButton, TextInput, FormActions } from "@/components/ui/form";
import { createFacilityAction, createLineAction } from "../actions";
import { ProductionTabs } from "../tabs";

export default async function LinesPage() {
  const ctx = await requireApp({ permission: "production.view" });
  const facilities = await withTenant(ctx, (tx) => tx.facility.findMany({ include: { lines: { include: { _count: { select: { shifts: true } } } }, _count: { select: { warehouses: true } } }, orderBy: { code: "asc" } }));
  const t = ctx.t;
  const plan = ctx.session.plan;
  return (
    <>
      <PageHeader
        title={t("Production / MES")}
        description={t("Production facilities and lines. Facility count is limited by the subscription plan.")}
        actions={
          <>
            {ctx.can("settings.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New facility")}</>} title="New production facility">
                <ActionForm action={createFacilityAction} className="space-y-4">
                  <TextInput name="code" label="Code" required placeholder="PLANT2" />
                  <TextInput name="name" label="Name" required />
                  <TextInput name="address" label="Address" />
                  <p className="text-[12px] text-ink-3">{t("Plan limit")}: {plan?.maxFacilities ?? t("Unlimited")}</p>
                  <FormError />
                  <FormActions><SubmitButton>Create facility</SubmitButton></FormActions>
                </ActionForm>
              </Modal>
            )}
            {ctx.can("production.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New line")}</>} title="New production line" triggerVariant="primary">
                <ActionForm action={createLineAction} className="space-y-4">
                  <SelectInput name="facilityId" label="Facility" required placeholder="" options={facilities.map((f) => ({ value: f.id, label: f.name }))} defaultValue={facilities[0]?.id} />
                  <TextInput name="code" label="Line code" required placeholder="L3" />
                  <TextInput name="name" label="Line name" required />
                  <NumberInput name="capacityKgPerHour" label="Capacity (kg/h)" />
                  <FormError />
                  <FormActions><SubmitButton>Create line</SubmitButton></FormActions>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      <ProductionTabs current="lines" t={t} />
      <div className="space-y-4">
        {facilities.map((f) => (
          <Card key={f.id}>
            <CardHeader title={`${f.code} — ${f.name}`} description={f.address ?? undefined} actions={<StatusBadge status={f.isActive ? "ACTIVE" : "INACTIVE"} />} />
            <SimpleTable head={[t("Code"), t("Line"), t("Capacity (kg/h)"), t("Shifts"), t("Status")]}>
              {f.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td">{l.code}</td>
                  <td className="td">{l.name}</td>
                  <td className="td tabular">{l.capacityKgPerHour ? fmtNum(l.capacityKgPerHour) : "—"}</td>
                  <td className="td tabular">{l._count.shifts}</td>
                  <td className="td"><StatusBadge status={l.isActive ? "ACTIVE" : "INACTIVE"} /></td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
        ))}
      </div>
    </>
  );
}
