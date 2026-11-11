import Link from "next/link";
import { Bird, LogOut } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t, session } = await requireSuperAdmin();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-navy-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><Bird className="h-4.5 w-4.5" /></span>
            <div>
              <div className="text-sm font-semibold">PoultryOS · {t("Super Admin")}</div>
              <div className="text-[11.5px] text-navy-300">{session.user.email}</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 text-[13px]">
            {[
              ["/admin", "Platform"],
              ["/admin/organizations", "Organizations"],
              ["/admin/plans", "Plans & pricing"],
              ["/admin/billing", "Subscription payments"],
              ["/admin/activity", "Activity"],
              ["/admin/emails", "Email outbox"],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="rounded-md px-2.5 py-1.5 text-navy-200 hover:bg-white/10 hover:text-white">{t(label)}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {session.tenant && <Link href="/app" className="text-[13px] text-navy-200 hover:text-white">{t("Open workspace")}</Link>}
            <LanguageSwitcher dark />
            <form action={signOutAction}>
              <button className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-navy-200 hover:bg-white/10"><LogOut className="h-4 w-4" /></button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
