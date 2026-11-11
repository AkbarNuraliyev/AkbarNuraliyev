import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { INTEGRATION_PROVIDERS } from "@/lib/integrations-catalog";
import { Alert, Card, CardHeader, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, SubmitButton, TextInput } from "@/components/ui/form";
import { disconnectIntegrationAction, saveIntegrationAction, testIntegrationAction } from "./actions";
import { IntegrationTabs } from "./tabs";

export default async function IntegrationsPage() {
  const ctx = await requireApp({ permission: "integrations.view" });
  const rows = await withTenant(ctx, (tx) => tx.integration.findMany());
  const t = ctx.t;
  const canManage = ctx.can("integrations.manage");
  const groups = [...new Set(INTEGRATION_PROVIDERS.map((p) => p.category))];
  return (
    <>
      <PageHeader title={t("Integrations")} description={t("Adapters for accounting, e-invoicing, telematics, POS and production equipment. A connector is shown as Connected only after a successful live connection test.")} />
      <IntegrationTabs current="providers" t={t} />
      <Alert tone="info" className="mb-4" title={t("Honest connection status")}>
        {t("No external system is connected by default. Where partner API documentation or credentials are not yet available, the adapter is prepared and data can be exchanged manually via CSV/Excel import and export.")}
      </Alert>
      {groups.map((g) => (
        <div key={g} className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">{t(g)}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {INTEGRATION_PROVIDERS.filter((p) => p.category === g).map((p) => {
              const row = rows.find((r) => r.provider === p.key);
              const config = (row?.config ?? {}) as Record<string, string>;
              return (
                <Card key={p.key}>
                  <CardHeader title={p.name} description={t(p.description)} actions={<StatusBadge status={row?.status ?? "NOT_CONNECTED"} />} />
                  <div className="grid gap-3 text-[13px] sm:grid-cols-2">
                    <div>
                      <div className="mb-1 font-medium text-ink-2">{t("Required to connect")}</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-ink-3">{p.requirements.map((r) => <li key={r}>{t(r)}</li>)}</ul>
                    </div>
                    <div>
                      <div className="mb-1 font-medium text-ink-2">{t("Data flows")}</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-ink-3">{p.dataFlows.map((r) => <li key={r}>{t(r)}</li>)}</ul>
                    </div>
                  </div>
                  {row?.lastTestedAt && <p className="mt-3 text-[12px] text-ink-3">{t("Last test")}: {fmtDateTime(row.lastTestedAt, ctx.tz)}{row.lastError ? ` — ${row.lastError}` : ""}</p>}
                  {row?.status === "CONFIGURED" && <p className="mt-2 text-[12px] text-amber-800">{t(p.testable ? "Credentials saved but not verified — run the connection test." : "Credentials saved. Activation requires the provider's partner API; status remains not connected for data exchange.")}</p>}
                  {canManage && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Modal trigger={t("Configure")} title={`${p.name}: ${t("settings")}`} triggerSize="sm">
                        <ActionForm action={saveIntegrationAction} className="space-y-3">
                          <Hidden name="provider" value={p.key} />
                          {p.fields.map((f) => (
                            <TextInput key={f.key} name={`f_${f.key}`} label={f.label} type={f.type === "secret" ? "password" : f.type === "url" ? "url" : "text"} defaultValue={f.type === "secret" ? undefined : config[f.key]} placeholder={f.type === "secret" && row?.encryptedSecret ? t("•••••• stored (leave empty to keep)") : f.placeholder} autoComplete="off" />
                          ))}
                          <p className="text-[12px] text-ink-3">{t("Secrets are encrypted at rest and never displayed again or sent to the browser.")}</p>
                          <FormError />
                          <div className="flex justify-end"><SubmitButton>Save settings</SubmitButton></div>
                        </ActionForm>
                      </Modal>
                      {p.testable && row?.status !== "NOT_CONNECTED" && <ActionButton action={testIntegrationAction} fields={{ provider: p.key }}>Test connection</ActionButton>}
                      {row && row.status !== "NOT_CONNECTED" && <ActionButton action={disconnectIntegrationAction} fields={{ provider: p.key }} variant="ghost" confirm="Disconnect and delete stored credentials?">Disconnect</ActionButton>}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ))}
      <Card>
        <CardHeader title={t("Manual data exchange (CSV / Excel)")} description={t("Available for every connector while API access is not active.")} />
        <div className="flex flex-wrap gap-2 text-[13px]">
          <Link href="/app/orders/import" className="link">{t("Import orders")}</Link> ·
          <a href="/api/export/products?format=xlsx" className="link">{t("Export products")}</a> ·
          <a href="/api/export/customers?format=xlsx" className="link">{t("Export customers")}</a> ·
          <a href="/api/export/receivables?format=xlsx" className="link">{t("Export invoices / receivables (for 1C, Didox)")}</a> ·
          <a href="/api/export/inventory?format=xlsx" className="link">{t("Export inventory")}</a> ·
          <a href="/api/export/shipments?format=xlsx" className="link">{t("Export shipments")}</a>
        </div>
        <p className="mt-3 text-[12px] text-ink-3"><Pill tone="amber">{t("Note")}</Pill> {t("Electronic invoices, e-signatures and government systems are not connected. Exports are working files for manual upload.")}</p>
      </Card>
    </>
  );
}
