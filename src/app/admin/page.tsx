import Link from "@/components/ui/link";
import { requireSuperAdmin } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { fmtDateTime, fmtMoneyShort, fmtNum, num } from "@/lib/format";
import { Card, CardHeader, Kpi, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";

export default async function AdminHome() {
  const { t } = await requireSuperAdmin();
  const since = new Date(Date.now() - 30 * 86400000);
  const data = await withSystem(async (tx) => {
    const [tenants, subs, users, orders30, receipts30, unpaid, recent, activity] = await Promise.all([
      tx.tenant.groupBy({ by: ["status", "isDemo"], _count: true }),
      tx.subscription.findMany({ include: { plan: true, tenant: { select: { isDemo: true } } } }),
      tx.user.count({ where: { isActive: true } }),
      tx.order.count({ where: { createdAt: { gte: since } } }),
      tx.rawMaterialReceipt.count({ where: { createdAt: { gte: since } } }),
      tx.billingInvoice.aggregate({ where: { status: "UNPAID" }, _sum: { amount: true }, _count: true }),
      tx.tenant.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { subscription: { include: { plan: true } } } }),
      tx.auditLog.findMany({ where: { action: { startsWith: "platform." } }, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);
    return { tenants, subs, users, orders30, receipts30, unpaid, recent, activity };
  });
  const real = data.subs.filter((s) => !s.tenant.isDemo);
  const mrr = real.filter((s) => s.status === "ACTIVE").reduce((sum, s) => sum + (s.billingCycle === "YEARLY" ? num(s.plan.priceYearly) / 12 : num(s.plan.priceMonthly)), 0);
  const count = (pred: (x: (typeof data.tenants)[number]) => boolean) => data.tenants.filter(pred).reduce((s, x) => s + x._count, 0);
  return (
    <>
      <PageHeader title={t("Platform overview")} description={t("Registered organizations, subscriptions and platform usage. Demo tenants are excluded from revenue figures.")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label={t("Organizations")} value={fmtNum(count(() => true))} sub={t("{n} demo", { n: count((x) => x.isDemo) })} href="/admin/organizations" />
        <Kpi label={t("Suspended")} value={fmtNum(count((x) => x.status === "SUSPENDED"))} />
        <Kpi label={t("Active subscriptions")} value={fmtNum(real.filter((s) => s.status === "ACTIVE").length)} />
        <Kpi label={t("Trials")} value={fmtNum(real.filter((s) => s.status === "TRIALING").length)} />
        <Kpi label={t("MRR (estimate)")} value={fmtMoneyShort(mrr)} />
        <Kpi label={t("Unpaid invoices")} value={fmtMoneyShort(num(data.unpaid._sum.amount))} sub={t("{n} invoices", { n: data.unpaid._count })} href="/admin/billing" />
        <Kpi label={t("Active users")} value={fmtNum(data.users)} sub={`${fmtNum(data.orders30)} ${t("orders")} · ${fmtNum(data.receipts30)} ${t("receipts")} / 30 d`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Newest organizations")} actions={<Link href="/admin/organizations" className="link text-[13px]">{t("All")}</Link>} />
          <SimpleTable head={[t("Organization"), t("Plan"), t("Subscription"), t("Created")]}>
            {data.recent.map((r) => (
              <tr key={r.id}>
                <td className="td"><Link href={`/admin/organizations/${r.id}`} className="link">{r.name}</Link> {r.isDemo && <span className="text-[11px] text-violet-700">demo</span>}</td>
                <td className="td">{r.subscription?.plan.name}</td>
                <td className="td">{r.subscription && <StatusBadge status={r.subscription.status} />}</td>
                <td className="td text-[12.5px]">{fmtDateTime(r.createdAt, "Asia/Tashkent")}</td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
        <Card>
          <CardHeader title={t("Platform operator activity")} actions={<Link href="/admin/activity" className="link text-[13px]">{t("All")}</Link>} />
          <ul className="space-y-2 text-[12.5px]">
            {data.activity.map((a) => <li key={a.id}><span className="text-ink-3">{fmtDateTime(a.createdAt, "Asia/Tashkent")}</span> · {a.userEmail} · {a.action} {a.summary && `— ${a.summary}`}</li>)}
            {data.activity.length === 0 && <li className="text-ink-3">{t("No operator actions yet.")}</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
