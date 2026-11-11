import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { PageHeader, Card, ProgressBar } from "@/components/ui/basic";

export default async function Onboarding() {
  const ctx = await requireApp();
  const c = await withTenant(ctx, async (tx) => {
    const [tenant, suppliers, farms, products, chambers, members, invites, customers, receipts, audit] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      tx.supplier.count(),
      tx.farm.count(),
      tx.product.count(),
      tx.storageChamber.count(),
      tx.membership.count(),
      tx.invitation.count(),
      tx.customer.count(),
      tx.rawMaterialReceipt.count(),
      tx.auditLog.count({ where: { action: "settings.update" } }),
    ]);
    return { tenant, suppliers, farms, products, chambers, members, invites, customers, receipts, audit };
  });
  const steps = [
    { done: !!c.tenant.taxId && !!c.tenant.address, title: "Complete company details", text: "Legal name, TIN, address, time zone and currency.", href: "/app/settings" },
    { done: c.audit > 0, title: "Review batch ID format and thresholds", text: `Current format: ${c.tenant.batchFormat}. Configure chilled/frozen temperature limits and shelf life.`, href: "/app/settings" },
    { done: c.suppliers > 0 && c.farms > 0, title: "Register suppliers and farms", text: "Each farm code becomes part of the batch ID.", href: "/app/procurement" },
    { done: c.products > 0, title: "Create the product catalog", text: "Cuts, by-products, frozen and processed products with shelf life and prices.", href: "/app/products" },
    { done: c.chambers > 0, title: "Configure warehouses and chambers", text: "A default factory cold store with chilled, frozen and quarantine chambers was created for you.", href: "/app/inventory/warehouses" },
    { done: c.customers > 0, title: "Add B2B customers and price lists", text: "Assign contract prices and invite customers to the portal.", href: "/app/sales" },
    { done: c.members + c.invites > 1, title: "Invite your team", text: "Assign roles and departments to control module access.", href: "/app/employees" },
    { done: c.receipts > 0, title: "Receive the first delivery", text: "Weigh, inspect and generate the first batch ID and QR code.", href: "/app/receiving/new" },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <>
      <PageHeader title={ctx.t("Set up your workspace")} description={ctx.t("Complete these steps to start operating {org} in PoultryOS.", { org: ctx.tenant.name })} />
      <Card className="mb-4">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">{ctx.t("{done} of {total} steps completed", { done, total: steps.length })}</span>
          <span className="text-ink-3">{Math.round((done / steps.length) * 100)}%</span>
        </div>
        <ProgressBar value={done} max={steps.length} />
      </Card>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {steps.map((s) => (
            <li key={s.title}>
              <Link href={s.href} className="flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50">
                {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-brand-600" /> : <Circle className="mt-0.5 h-5 w-5 text-slate-300" />}
                <div>
                  <div className="text-sm font-medium text-ink">{ctx.t(s.title)}</div>
                  <div className="text-[13px] text-ink-3">{ctx.t(s.text)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
