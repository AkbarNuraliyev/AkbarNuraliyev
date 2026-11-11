import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import { FEATURES } from "@/lib/modules";
import { Card, CardHeader, DescriptionList, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { saveFeatureOverridesAction, setTenantStatusAction, updateSubscriptionAction } from "../../actions";
import { PaymentConfirm } from "../../billing/payment-confirm";

export default async function AdminOrg({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requireSuperAdmin();
  const { id } = await params;
  const data = await withSystem(async (tx) => {
    const org = await tx.tenant.findUnique({
      where: { id },
      include: { subscription: { include: { plan: true } }, featureOverrides: true, billingInvoices: { orderBy: { issuedAt: "desc" } }, memberships: { include: { user: true, role: true } } },
    });
    if (!org) return null;
    const [plans, counts] = await Promise.all([
      tx.plan.findMany({ orderBy: { sortOrder: "asc" } }),
      Promise.all([tx.facility.count({ where: { tenantId: id } }), tx.warehouse.count({ where: { tenantId: id, type: { not: "RETAIL" } } }), tx.retailLocation.count({ where: { tenantId: id } }), tx.product.count({ where: { tenantId: id } })]),
    ]);
    return { org, plans, counts };
  });
  if (!data) notFound();
  const { org, plans } = data;
  const sub = org.subscription;
  const override = (k: string) => org.featureOverrides.find((o) => o.feature === k);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Organizations"), href: "/admin/organizations" }, { label: org.name }]}
        title={org.name}
        description={`${org.slug} · ${org.legalName ?? ""} · ${t("TIN")} ${org.taxId ?? "—"}`}
        actions={
          <>
            <StatusBadge status={org.status} />
            {org.status === "ACTIVE" ? (
              <ActionButton action={setTenantStatusAction} fields={{ tenantId: org.id, status: "SUSPENDED" }} variant="danger" size="md" reasonLabel="Reason (audit log)" confirm="Suspend this organization?">Suspend</ActionButton>
            ) : (
              <ActionButton action={setTenantStatusAction} fields={{ tenantId: org.id, status: "ACTIVE" }} variant="primary" size="md" confirm="Activate this organization?" confirmVariant="primary">Activate</ActionButton>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("Usage")} />
          <DescriptionList
            cols={1}
            items={[
              { label: t("Members"), value: org.memberships.length },
              { label: t("Facilities"), value: data.counts[0] },
              { label: t("Warehouses"), value: data.counts[1] },
              { label: t("Retail locations"), value: data.counts[2] },
              { label: t("Products"), value: data.counts[3] },
              { label: t("Created"), value: fmtDate(org.createdAt, "Asia/Tashkent") },
              { label: t("Suspension reason"), value: org.suspendReason },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("Subscription")} actions={sub && <StatusBadge status={sub.status} />} />
          {sub && (
            <ActionForm action={updateSubscriptionAction} className="space-y-3">
              <Hidden name="tenantId" value={org.id} />
              <SelectInput name="planId" label="Plan" defaultValue={sub.planId} options={plans.map((p) => ({ value: p.id, label: p.name }))} />
              <SelectInput name="status" label="Status" defaultValue={sub.status} options={["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"].map((s) => ({ value: s, label: s }))} />
              <TextInput name="trialEndsAt" label="Trial ends" type="date" defaultValue={sub.trialEndsAt?.toISOString().slice(0, 10)} />
              <NumberInput name="customMaxUsers" label="Custom user limit (Enterprise)" defaultValue={sub.customMaxUsers} step={1} />
              <FormError />
              <SubmitButton className="w-full">Save subscription</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card>
          <CardHeader title={t("Feature availability")} description={t("Overrides on top of the plan's features")} />
          <ActionForm action={saveFeatureOverridesAction} className="space-y-1.5">
            <Hidden name="tenantId" value={org.id} />
            <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
              {FEATURES.map((f) => {
                const o = override(f.key);
                const inPlan = sub?.plan.features.includes(f.key);
                return (
                  <label key={f.key} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className={inPlan ? "text-ink" : "text-ink-3"}>{t(f.label)}</span>
                    <select name={`f_${f.key}`} defaultValue={o ? (o.enabled ? "on" : "off") : ""} className="input h-7 w-28 py-0 text-[12px]">
                      <option value="">{inPlan ? t("plan: on") : t("plan: off")}</option>
                      <option value="on">{t("force on")}</option>
                      <option value="off">{t("force off")}</option>
                    </select>
                  </label>
                );
              })}
            </div>
            <FormError />
            <SubmitButton className="mt-2 w-full">Save features</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title={t("Billing invoices")} />
        <SimpleTable head={[t("Invoice"), t("Description"), t("Issued"), t("Due"), t("Amount"), t("Status"), ""]}>
          {org.billingInvoices.map((i) => (
            <tr key={i.id}>
              <td className="td font-mono text-[12px]">{i.number}</td>
              <td className="td">{i.description}</td>
              <td className="td">{fmtDate(i.issuedAt, "Asia/Tashkent")}</td>
              <td className="td">{fmtDate(i.dueAt, "Asia/Tashkent")}</td>
              <td className="td tabular">{fmtMoney(i.amount)}</td>
              <td className="td"><StatusBadge status={i.status} /></td>
              <td className="td text-right">{i.status === "UNPAID" && <PaymentConfirm invoiceId={i.id} number={i.number} />}</td>
            </tr>
          ))}
        </SimpleTable>
      </Card>
      <Card className="mt-4">
        <CardHeader title={t("Members")} />
        <SimpleTable head={[t("Name"), t("Email"), t("Role"), t("Status")]}>
          {org.memberships.map((m) => (
            <tr key={m.id}><td className="td">{m.user.name}</td><td className="td">{m.user.email}</td><td className="td">{t(m.role.name)}</td><td className="td"><StatusBadge status={m.status} /></td></tr>
          ))}
        </SimpleTable>
      </Card>
    </>
  );
}
