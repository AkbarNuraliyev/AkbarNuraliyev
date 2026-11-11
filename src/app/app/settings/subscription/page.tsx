import { Check } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Alert, Card, CardHeader, DescriptionList, PageHeader, ProgressBar, cx } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/dialog";
import { FEATURES } from "@/lib/modules";
import { usage } from "@/server/services/billing";
import { cancelSubscriptionAction, changePlanAction } from "../actions";
import { SettingsTabs } from "../tabs";

export default async function SubscriptionPage() {
  const ctx = await requireApp();
  const [data, plans] = await Promise.all([
    withTenant(ctx, async (tx) => ({
      sub: await tx.subscription.findUniqueOrThrow({ where: { tenantId: ctx.tenantId }, include: { plan: true } }),
      invoices: await tx.billingInvoice.findMany({ orderBy: { issuedAt: "desc" } }),
      u: await usage(tx),
    })),
    prisma.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const { sub, invoices, u } = data;
  const t = ctx.t;
  const canBill = ctx.can("settings.billing");
  const st = ctx.session.subscription!;
  const limits: [string, number, number | null][] = [
    ["Users (incl. pending invitations)", u.users, sub.customMaxUsers ?? sub.plan.maxUsers],
    ["Production facilities", u.facilities, sub.plan.maxFacilities],
    ["Warehouses", u.warehouses, sub.plan.maxWarehouses],
    ["Retail locations", u.retail, sub.plan.maxRetailLocations],
  ];
  return (
    <>
      <PageHeader title={t("Settings & Subscription")} description={t("Plan, usage limits, payment status and billing history.")} />
      <SettingsTabs current="subscription" t={t} />
      {ctx.tenant.isDemo && <Alert tone="info" className="mb-4">{t("The SAFI Demo workspace runs on an Enterprise subscription for demonstration; plan changes are disabled.")}</Alert>}
      {!st.writable && <Alert tone="critical" className="mb-4" title={t("Subscription inactive")}>{t("The workspace is read-only until an invoice is paid.")}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`${t("Current plan")}: ${t(sub.plan.name)}`} actions={<StatusBadge status={st.status} />} />
          <DescriptionList
            cols={3}
            items={[
              { label: t("Billing cycle"), value: t(sub.billingCycle === "YEARLY" ? "Yearly" : "Monthly") },
              { label: t("Price"), value: fmtMoney(sub.billingCycle === "YEARLY" ? sub.plan.priceYearly : sub.plan.priceMonthly) },
              { label: sub.status === "TRIALING" ? t("Trial ends") : t("Current period ends"), value: fmtDate(sub.trialEndsAt ?? sub.currentPeriodEnd, ctx.tz) },
              { label: t("Renewal"), value: sub.cancelAtPeriodEnd ? t("Cancels at period end") : t("Renews automatically (invoice)") },
              { label: t("Payment provider"), value: t("Not connected — bank transfer, confirmed by the platform operator") },
            ]}
          />
          {canBill && !ctx.tenant.isDemo && (
            <div className="mt-4">
              <ActionButton action={cancelSubscriptionAction} fields={{ cancel: sub.cancelAtPeriodEnd ? "no" : "yes" }} size="md" confirm={sub.cancelAtPeriodEnd ? "Resume renewal?" : "Cancel at the end of the period?"} confirmText="You can change this decision until the period ends." confirmVariant={sub.cancelAtPeriodEnd ? "primary" : "danger"}>
                {sub.cancelAtPeriodEnd ? "Resume subscription" : "Cancel subscription"}
              </ActionButton>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title={t("Usage")} />
          <div className="space-y-3">
            {limits.map(([label, used, lim]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-2">{t(label)}</span><span className="tabular font-medium">{used} / {lim === null ? "∞" : lim}</span></div>
                <ProgressBar value={used} max={lim ?? Math.max(used, 1) * 4} tone={lim !== null && used >= lim ? "red" : "green"} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {plans.map((p) => {
          const current = p.id === sub.planId;
          return (
            <Card key={p.id} className={cx(current && "border-brand-500")}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">{t(p.name)}</h3>
                {current && <StatusBadge status="ACTIVE" label="Current" />}
              </div>
              <div className="mt-2 text-xl font-semibold">{fmtMoney(p.priceMonthly)}<span className="text-sm font-normal text-ink-3"> / {t("month")}</span></div>
              <div className="text-[12.5px] text-ink-3">{fmtMoney(p.priceYearly)} / {t("year")}</div>
              <ul className="mt-3 space-y-1 text-[12.5px]">
                {FEATURES.filter((f) => p.features.includes(f.key)).slice(0, 12).map((f) => (
                  <li key={f.key} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />{t(f.label)}</li>
                ))}
              </ul>
              {canBill && !ctx.tenant.isDemo && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {(["MONTHLY", "YEARLY"] as const).map((cycle) =>
                    current && sub.billingCycle === cycle && sub.status === "ACTIVE" ? null : (
                      <ActionButton key={cycle} action={changePlanAction} fields={{ planCode: p.code, billingCycle: cycle }} variant={p.code === "GROWTH" ? "primary" : "secondary"} confirm={`${t("Switch to")} ${t(p.name)} (${t(cycle === "YEARLY" ? "yearly" : "monthly")})?`} confirmText="An invoice is issued. Downgrades are refused if your current usage exceeds the new plan limits." confirmVariant="primary">
                        {cycle === "YEARLY" ? "Choose yearly" : "Choose monthly"}
                      </ActionButton>
                    ),
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Card className="mt-4">
        <CardHeader title={t("Billing history")} description={t("Online card payments are not connected. Pay invoices by bank transfer quoting the invoice number; the platform operator confirms receipt.")} />
        <SimpleTable head={[t("Invoice"), t("Description"), t("Period"), t("Issued"), t("Due"), t("Amount"), t("Status"), t("Paid")]}>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td className="td font-mono text-[12.5px]">{i.number}</td>
              <td className="td">{i.description}</td>
              <td className="td text-[12.5px]">{fmtDate(i.periodStart, ctx.tz)} – {fmtDate(i.periodEnd, ctx.tz)}</td>
              <td className="td">{fmtDate(i.issuedAt, ctx.tz)}</td>
              <td className="td">{fmtDate(i.dueAt, ctx.tz)}</td>
              <td className="td tabular">{fmtMoney(i.amount, i.currency)}</td>
              <td className="td"><StatusBadge status={i.status} /></td>
              <td className="td text-[12.5px]">{i.paidAt ? `${fmtDate(i.paidAt, ctx.tz)} · ${i.paymentMethod ?? ""} ${i.paymentRef ?? ""}` : "—"}</td>
            </tr>
          ))}
          {invoices.length === 0 && <tr><td className="td text-center text-ink-3" colSpan={8}>{t("No invoices yet.")}</td></tr>}
        </SimpleTable>
      </Card>
    </>
  );
}
