import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, ResultLink, SubmitButton, TextInput } from "@/components/ui/form";
import { WEBHOOK_EVENTS } from "@/server/services/webhooks";
import { createWebhookAction, deleteWebhookAction, testWebhookAction } from "../actions";
import { IntegrationTabs } from "../tabs";

export default async function WebhooksPage() {
  const ctx = await requireApp({ permission: "integrations.view", feature: "webhooks" });
  const data = await withTenant(ctx, async (tx) => ({
    hooks: await tx.webhook.findMany({ orderBy: { createdAt: "desc" } }),
    deliveries: await tx.webhookDelivery.findMany({ include: { webhook: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  }));
  const t = ctx.t;
  const canManage = ctx.can("integrations.manage");
  return (
    <>
      <PageHeader
        title={t("Integrations")}
        description={t("Outgoing webhooks notify external systems about events. Each delivery is signed with HMAC-SHA256 in the X-PoultryOS-Signature header.")}
        actions={
          canManage && (
            <Modal trigger={t("Add webhook")} title="Add webhook" triggerVariant="primary">
              <ActionForm action={createWebhookAction} className="space-y-3" closeOnSuccess={false}>
                <TextInput name="url" label="Endpoint URL (https)" required type="url" />
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {WEBHOOK_EVENTS.map((e) => (
                    <label key={e} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="events" value={e} className="h-4 w-4 accent-brand-600" /> <code>{e}</code></label>
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
      <IntegrationTabs current="webhooks" t={t} />
      <Card className="mb-4">
        <CardHeader title={t("Endpoints")} />
        <SimpleTable head={[t("URL"), t("Events"), t("Created"), t("Status"), ""]}>
          {data.hooks.map((h) => (
            <tr key={h.id}>
              <td className="td font-mono text-[12px]">{h.url}</td>
              <td className="td"><div className="flex flex-wrap gap-1">{h.events.map((e) => <Pill key={e}>{e}</Pill>)}</div></td>
              <td className="td text-[12.5px]">{fmtDateTime(h.createdAt, ctx.tz)}</td>
              <td className="td"><StatusBadge status={h.isActive ? "ACTIVE" : "INACTIVE"} /></td>
              <td className="td whitespace-nowrap text-right">
                {canManage && (
                  <>
                    <ActionButton action={testWebhookAction} fields={{ id: h.id }}>Send test</ActionButton>{" "}
                    <ActionButton action={deleteWebhookAction} fields={{ id: h.id }} variant="ghost" confirm="Delete this webhook?">Delete</ActionButton>
                  </>
                )}
              </td>
            </tr>
          ))}
          {data.hooks.length === 0 && <tr><td colSpan={5} className="td text-center text-ink-3">{t("No webhooks configured.")}</td></tr>}
        </SimpleTable>
      </Card>
      <Card>
        <CardHeader title={t("Recent deliveries")} />
        <SimpleTable head={[t("Time"), t("Event"), t("Endpoint"), t("Status"), t("Response")]}>
          {data.deliveries.map((d) => (
            <tr key={d.id}>
              <td className="td text-[12.5px]">{fmtDateTime(d.createdAt, ctx.tz)}</td>
              <td className="td font-mono text-[12px]">{d.event}</td>
              <td className="td font-mono text-[11.5px]">{d.webhook.url}</td>
              <td className="td"><StatusBadge status={d.status === "PENDING" ? "QUEUED" : d.status} /></td>
              <td className="td text-[12px]">{d.responseCode ?? ""} {d.error}</td>
            </tr>
          ))}
        </SimpleTable>
      </Card>
    </>
  );
}
