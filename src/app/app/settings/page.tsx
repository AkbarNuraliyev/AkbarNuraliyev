import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { localDateKey } from "@/lib/tz";
import { BATCH_TOKENS, renderBatchCode } from "@/server/core";
import { Card, CardHeader, PageHeader } from "@/components/ui/basic";
import { ActionForm, Checkbox, FormActions, FormError, FormGrid, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { updateOrganizationAction, updateThresholdsAction } from "./actions";
import { SettingsTabs } from "./tabs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function SettingsPage() {
  const ctx = await requireApp();
  const tenant = await withTenant(ctx, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }));
  const s = ctx.settings;
  const t = ctx.t;
  const canEdit = ctx.can("settings.manage");
  const preview = renderBatchCode(tenant.batchFormat, { prefix: tenant.batchPrefix, dateKey: localDateKey(new Date(), ctx.tz), farm: "FARM001", supplier: "SUP01", facility: "PLANT1", seq: 1 });
  return (
    <>
      <PageHeader title={t("Settings & Subscription")} description={t("Organization profile, locale, batch numbering and operational thresholds.")} />
      <SettingsTabs current="general" t={t} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("Organization")} />
          <ActionForm action={updateOrganizationAction} className="space-y-4">
            <FormGrid>
              <TextInput name="name" label="Display name" required defaultValue={tenant.name} />
              <TextInput name="legalName" label="Legal name" defaultValue={tenant.legalName} />
              <TextInput name="taxId" label="TIN" defaultValue={tenant.taxId} />
              <TextInput name="phone" label="Phone" defaultValue={tenant.phone} />
              <TextInput name="email" label="Email" type="email" defaultValue={tenant.email} />
              <TextInput name="address" label="Address" defaultValue={tenant.address} />
            </FormGrid>
            <FormGrid cols={3}>
              <TextInput name="timezone" label="Time zone" required defaultValue={tenant.timezone} hint="IANA name, e.g. Asia/Tashkent" />
              <SelectInput name="currency" label="Currency" defaultValue={tenant.currency} options={["UZS", "USD", "EUR", "RUB", "KZT"].map((c) => ({ value: c, label: c }))} />
              <SelectInput name="locale" label="Default language" defaultValue={tenant.locale} options={[{ value: "ru", label: "Русский" }, { value: "uz", label: "O‘zbekcha" }, { value: "en", label: "English" }]} />
            </FormGrid>
            <div className="rounded-lg border border-line p-3">
              <div className="mb-3 text-sm font-medium">{t("Batch ID format")}</div>
              <FormGrid cols={3}>
                <TextInput name="batchPrefix" label="Prefix" required defaultValue={tenant.batchPrefix} />
                <TextInput name="batchFormat" label="Template" required defaultValue={tenant.batchFormat} className="sm:col-span-2" />
              </FormGrid>
              <p className="mt-2 text-[12px] text-ink-3">{t("Tokens")}: {BATCH_TOKENS.join(" ")}. {t("The sequence resets daily when the template contains a date token.")}</p>
              <p className="mt-1 text-[12.5px]">{t("Current example")}: <span className="font-mono font-semibold">{preview}</span></p>
            </div>
            <p className="text-[12px] text-ink-3">{t("Dates are displayed as DD.MM.YYYY; weights in kg and tonnes.")}</p>
            <FormError />
            {canEdit && <FormActions><SubmitButton>Save organization</SubmitButton></FormActions>}
          </ActionForm>
        </Card>
        <Card>
          <CardHeader title={t("Operational thresholds")} description={t("Demonstration defaults: chilled ≤ +4 °C, frozen −18 °C, 72 h chilled shelf life.")} />
          <ActionForm action={updateThresholdsAction} className="space-y-4">
            <FormGrid cols={4}>
              <NumberInput name="chilledMinTempC" label="Chilled min °C" defaultValue={s.chilledMinTempC} />
              <NumberInput name="chilledMaxTempC" label="Chilled max °C" defaultValue={s.chilledMaxTempC} />
              <NumberInput name="frozenTargetTempC" label="Frozen target °C" defaultValue={s.frozenTargetTempC} />
              <NumberInput name="frozenMaxTempC" label="Frozen alert above °C" defaultValue={s.frozenMaxTempC} />
              <NumberInput name="chilledShelfLifeHours" label="Chilled shelf life (h)" defaultValue={s.chilledShelfLifeHours} step={1} />
              <NumberInput name="expiryWarningHours" label="Expiry warning (h)" defaultValue={s.expiryWarningHours} step={1} />
              <NumberInput name="massBalanceTolerancePct" label="Mass balance tolerance %" defaultValue={s.massBalanceTolerancePct} />
              <NumberInput name="inFullTolerancePct" label="In-full tolerance %" defaultValue={s.inFullTolerancePct} />
              <NumberInput name="forecastWeeks" label="Forecast history (weeks)" defaultValue={s.forecastWeeks} step={1} />
              <NumberInput name="forecastSafetyStockPct" label="Safety stock %" defaultValue={s.forecastSafetyStockPct} />
              <NumberInput name="defaultPaymentTermsDays" label="Default payment terms (days)" defaultValue={s.defaultPaymentTermsDays} step={1} />
            </FormGrid>
            <div>
              <div className="label">{t("Monthly seasonal demand factors (forecasting)")}</div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {MONTHS.map((m, i) => (
                  <label key={m} className="text-[12px] text-ink-3">
                    {t(m)}
                    <input name={`season_${i + 1}`} type="number" step="0.01" min={0.3} max={3} defaultValue={s.seasonalFactors[i]} className="input h-8 py-1" />
                  </label>
                ))}
              </div>
            </div>
            <Checkbox name="showFarmOnPublicPage" label="Show farm region on the public QR page" defaultChecked={s.showFarmOnPublicPage} />
            <TextInput name="publicPageMessage" label="Public QR page message" defaultValue={s.publicPageMessage} />
            <FormError />
            {canEdit && <FormActions><SubmitButton>Save thresholds</SubmitButton></FormActions>}
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
