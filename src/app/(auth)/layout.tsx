import Link from "next/link";
import { Bird } from "lucide-react";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { getI18n } from "@/lib/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Bird className="h-4.5 w-4.5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">PoultryOS</span>
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-10">{children}</main>
      <footer className="pb-6 text-center text-[12px] text-ink-3">
        © 2026 PoultryOS · <Link href="/pricing" className="hover:text-ink">{t("Pricing")}</Link> · <Link href="/roi" className="hover:text-ink">{t("ROI calculator")}</Link>
      </footer>
    </div>
  );
}
