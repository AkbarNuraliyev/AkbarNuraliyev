import Link from "@/components/ui/link";
import { Bird, LogOut } from "lucide-react";
import { requirePortal } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePortal();
  const customer = await withTenant(ctx, (tx) => tx.customer.findUnique({ where: { id: ctx.customerId }, select: { name: true } }));
  const t = ctx.t;
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><Bird className="h-4.5 w-4.5" /></span>
            <div>
              <div className="text-sm font-semibold">{ctx.tenant.name} · {t("B2B portal")}</div>
              <div className="text-[11.5px] text-navy-300">{customer?.name}</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 text-[13px]">
            {[
              ["/portal", "Dashboard"],
              ["/portal/catalog", "Catalog & prices"],
              ["/portal/orders/new", "New order"],
              ["/portal/orders", "My orders"],
              ["/portal/documents", "Documents"],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="rounded-md px-2.5 py-1.5 text-navy-200 hover:bg-white/10 hover:text-white">{t(label)}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher dark />
            <form action={signOutAction}>
              <button className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-navy-200 hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /> {t("Sign out")}</button>
            </form>
          </div>
        </div>
      </header>
      {ctx.tenant.isDemo && <div className="bg-violet-50 px-4 py-1.5 text-center text-[12px] text-violet-900">{t("Demonstration portal — orders and data are demo records.")}</div>}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
