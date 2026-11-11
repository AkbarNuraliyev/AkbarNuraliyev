import Link from "@/components/ui/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import { Shell, type NavItem } from "@/components/app/shell";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireApp();
  const s = ctx.session;
  const unread = await withTenant(ctx, (tx) => tx.notification.count({ where: { readAt: null, status: "OPEN" } }));
  const nav: NavItem[] = MODULES.filter((m) => m.key === "overview" || m.key === "settings" || ctx.can(`${m.key}.view`)).map((m) => ({
    key: m.key,
    label: m.label,
    path: m.path,
    icon: m.icon,
    locked: !!m.feature && !ctx.has(m.feature),
  }));
  const sub = s.subscription;
  let banner: React.ReactNode = null;
  if (sub && !sub.writable) {
    banner = (
      <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-[13px] text-red-800">
        {ctx.t("Your subscription is not active — the workspace is read-only.")}{" "}
        <Link href="/app/settings/subscription" className="font-semibold underline">
          {ctx.t("Renew subscription")}
        </Link>
      </div>
    );
  } else if (sub?.status === "TRIALING" && sub.trialDaysLeft !== null && !ctx.tenant.isDemo) {
    banner = (
      <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-center text-[13px] text-blue-900">
        {ctx.t("Free trial: {days} day(s) left (until {date}).", { days: sub.trialDaysLeft, date: fmtDate(sub.trialEndsAt, ctx.tz) })}{" "}
        <Link href="/app/settings/subscription" className="font-semibold underline">
          {ctx.t("Choose a plan")}
        </Link>
      </div>
    );
  } else if (ctx.tenant.isDemo) {
    banner = (
      <div className="border-b border-violet-100 bg-violet-50 px-4 py-1.5 text-center text-[12.5px] text-violet-900">
        {ctx.t("SAFI Demo workspace: all records are demonstration data and are kept separate from real tenants. Production volumes and prices are illustrative assumptions.")}
      </div>
    );
  }
  return (
    <Shell
      nav={nav}
      tenantName={ctx.tenant.name}
      isDemo={ctx.tenant.isDemo}
      userName={s.user.name}
      userEmail={s.user.email}
      roleName={s.membership!.roleName}
      unread={unread}
      memberships={s.memberships}
      currentTenantId={ctx.tenantId}
      banner={banner}
      isSuperAdmin={s.user.isSuperAdmin}
    >
      {children}
    </Shell>
  );
}
