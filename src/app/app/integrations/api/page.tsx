import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, ResultLink, SubmitButton, TextInput } from "@/components/ui/form";
import { API_SCOPES } from "@/server/services/integrations";
import { appUrl } from "@/server/services/email";
import { createApiKeyAction, revokeApiKeyAction } from "../actions";
import { IntegrationTabs } from "../tabs";

const ENDPOINTS = [
  ["GET", "/api/v1/products", "products:read", "Product catalog with prices"],
  ["GET", "/api/v1/inventory?sku=", "inventory:read", "Available stock by product and batch (FEFO order)"],
  ["GET", "/api/v1/orders?status=&since=", "orders:read", "Orders"],
  ["POST", "/api/v1/orders", "orders:write", "Create an order (retail-chain EDI)"],
  ["GET", "/api/v1/orders/{number}", "orders:read", "Order status and delivered quantities"],
  ["GET", "/api/v1/batches/{code}/trace", "trace:read", "Batch traceability summary"],
  ["POST", "/api/v1/telemetry/temperature", "telemetry:write", "Temperature readings from devices / gateways"],
  ["POST", "/api/v1/scale-readings", "scales:write", "Weight readings from industrial scales"],
];

export default async function ApiPage() {
  const ctx = await requireApp({ permission: "integrations.view", feature: "api" });
  const keys = await withTenant(ctx, (tx) => tx.apiKey.findMany({ orderBy: { createdAt: "desc" } }));
  const t = ctx.t;
  const canManage = ctx.can("integrations.manage");
  return (
    <>
      <PageHeader
        title={t("Integrations")}
        description={t("REST API for ERP systems, retail-chain ordering and device gateways. Keys are tenant-scoped and permission-scoped.")}
        actions={
          canManage && (
            <Modal trigger={t("Create API key")} title="Create API key" triggerVariant="primary">
              <ActionForm action={createApiKeyAction} className="space-y-3" closeOnSuccess={false}>
                <TextInput name="name" label="Key name" required placeholder="Baraka EDI" />
                <div className="grid grid-cols-2 gap-1.5">
                  {API_SCOPES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="scopes" value={s} className="h-4 w-4 accent-brand-600" /> <code>{s}</code></label>
                  ))}
                </div>
                <ResultLink />
                <FormError />
                <div className="flex justify-end"><SubmitButton>Create</SubmitButton></div>
              </ActionForm>
            </Modal>
          )
        }
      />
      <IntegrationTabs current="api" t={t} />
      <Card className="mb-4">
        <CardHeader title={t("API keys")} />
        <SimpleTable head={[t("Name"), t("Key"), t("Scopes"), t("Created"), t("Last used"), t("Status"), ""]}>
          {keys.map((k) => (
            <tr key={k.id}>
              <td className="td">{k.name}</td>
              <td className="td font-mono text-[12px]">{k.prefix}…</td>
              <td className="td"><div className="flex flex-wrap gap-1">{k.scopes.map((s) => <Pill key={s}>{s}</Pill>)}</div></td>
              <td className="td text-[12.5px]">{fmtDateTime(k.createdAt, ctx.tz)}</td>
              <td className="td text-[12.5px]">{fmtDateTime(k.lastUsedAt, ctx.tz)}</td>
              <td className="td"><StatusBadge status={k.revokedAt ? "CANCELLED" : "ACTIVE"} label={k.revokedAt ? "Revoked" : "Active"} /></td>
              <td className="td text-right">{canManage && !k.revokedAt && <ActionButton action={revokeApiKeyAction} fields={{ id: k.id }} variant="ghost" confirm="Revoke this API key?" confirmText="Systems using it will immediately lose access.">Revoke</ActionButton>}</td>
            </tr>
          ))}
          {keys.length === 0 && <tr><td colSpan={7} className="td text-center text-ink-3">{t("No API keys yet.")}</td></tr>}
        </SimpleTable>
      </Card>
      <Card>
        <CardHeader title={t("Endpoints")} description={<>{t("Authentication")}: <code>Authorization: Bearer pos_live_…</code> · {t("OpenAPI")}: <a className="link" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a></>} />
        <SimpleTable head={[t("Method"), t("Path"), t("Scope"), t("Description")]}>
          {ENDPOINTS.map(([m, p, s, d]) => (
            <tr key={p + m}>
              <td className="td"><Pill tone={m === "GET" ? "blue" : "green"}>{m}</Pill></td>
              <td className="td font-mono text-[12.5px]">{p}</td>
              <td className="td font-mono text-[12px]">{s}</td>
              <td className="td text-[13px]">{t(d)}</td>
            </tr>
          ))}
        </SimpleTable>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-navy-950 p-4 text-[12px] leading-relaxed text-navy-200">{`curl -X POST ${appUrl("/api/v1/orders")} \\
  -H "Authorization: Bearer pos_live_..." -H "Content-Type: application/json" \\
  -d '{"customer_code":"C007","delivery_date":"2026-11-12","external_ref":"PO-55120",
       "items":[{"sku":"CH-BRF","quantity_kg":120},{"sku":"CH-WHOLE","quantity_kg":300}]}'`}</pre>
      </Card>
    </>
  );
}
