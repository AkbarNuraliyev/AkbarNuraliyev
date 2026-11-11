import Link from "next/link";
import { Bird } from "lucide-react";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth";
import { buttonClass } from "@/components/ui/basic";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  const session = await getSession();
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Bird className="h-4.5 w-4.5" />
            </span>
            <span className="text-[16px] font-semibold tracking-tight text-ink">PoultryOS</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-5 text-sm text-ink-2 md:flex">
            <Link href="/#modules" className="hover:text-ink">{t("Platform")}</Link>
            <Link href="/#traceability" className="hover:text-ink">{t("Traceability")}</Link>
            <Link href="/pricing" className="hover:text-ink">{t("Pricing")}</Link>
            <Link href="/roi" className="hover:text-ink">{t("ROI calculator")}</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            {session ? (
              <Link href={session.user.isSuperAdmin && !session.tenant ? "/admin" : "/app"} className={buttonClass("dark", "md")}>
                {t("Open app")}
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonClass("ghost", "md", "hidden sm:inline-flex")}>
                  {t("Sign in")}
                </Link>
                <Link href="/register" className={buttonClass("primary", "md")}>
                  {t("Start free trial")}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-ink-3 sm:grid-cols-3 sm:px-6">
          <div>
            <div className="flex items-center gap-2 font-semibold text-ink">
              <Bird className="h-4 w-4 text-brand-600" /> PoultryOS
            </div>
            <p className="mt-2 max-w-xs text-[13px]">{t("Integrated production and distribution management for poultry businesses.")}</p>
          </div>
          <div className="space-y-1.5 text-[13px]">
            <Link href="/pricing" className="block hover:text-ink">{t("Pricing")}</Link>
            <Link href="/roi" className="block hover:text-ink">{t("ROI calculator")}</Link>
            <Link href="/login" className="block hover:text-ink">{t("Sign in")}</Link>
          </div>
          <div className="text-[12px] leading-relaxed">
            {t("PoultryOS supports digital food-safety documentation (HACCP, FSSC 22000 record-keeping). Using the software does not by itself grant any certification.")}
            <div className="mt-3 sm:hidden">
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
