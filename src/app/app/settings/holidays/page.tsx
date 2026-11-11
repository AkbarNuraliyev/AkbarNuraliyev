import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDay } from "@/lib/format";
import { Card, CardHeader, PageHeader } from "@/components/ui/basic";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/dialog";
import { ActionForm, FormError, NumberInput, SubmitButton, TextInput } from "@/components/ui/form";
import { addHolidayAction, deleteHolidayAction } from "../actions";
import { SettingsTabs } from "../tabs";

export default async function HolidaysPage() {
  const ctx = await requireApp();
  const rows = await withTenant(ctx, (tx) => tx.holiday.findMany({ orderBy: { date: "asc" } }));
  const t = ctx.t;
  const canEdit = ctx.can("settings.manage");
  return (
    <>
      <PageHeader title={t("Settings & Subscription")} description={t("Holiday calendar with demand factors used by the forecast. Movable holidays (Hayit) must be confirmed each year.")} />
      <SettingsTabs current="holidays" t={t} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <SimpleTable head={[t("Date"), t("Holiday"), t("Demand factor"), ""]}>
          {rows.map((h) => (
            <tr key={h.id}>
              <td className="td">{fmtDay(h.date)}</td>
              <td className="td">{t(h.name)}</td>
              <td className="td tabular">×{h.demandFactor}</td>
              <td className="td text-right">{canEdit && <ActionButton action={deleteHolidayAction} fields={{ id: h.id }} variant="ghost" confirm="Remove this holiday?">Delete</ActionButton>}</td>
            </tr>
          ))}
        </SimpleTable>
        {canEdit && (
          <Card>
            <CardHeader title={t("Add / update holiday")} />
            <ActionForm action={addHolidayAction} className="space-y-3" resetOnSuccess>
              <TextInput name="date" label="Date" type="date" required />
              <TextInput name="name" label="Name" required />
              <NumberInput name="demandFactor" label="Demand factor" required defaultValue={1.2} step={0.05} hint="1.2 = +20% expected demand" />
              <FormError />
              <SubmitButton className="w-full">Save</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
