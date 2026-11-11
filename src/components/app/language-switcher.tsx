"use client";

import { useTransition } from "react";
import { Globe } from "lucide-react";
import { LOCALES } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/client";
import { setLocaleAction } from "@/app/actions";
import { cx } from "@/components/ui/basic";

export function LanguageSwitcher({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const locale = useLocale();
  const [pending, start] = useTransition();
  return (
    <div className={cx("inline-flex items-center gap-1 rounded-md p-0.5", dark ? "bg-white/10" : "border border-line bg-white", pending && "opacity-60")}>
      {!compact && <Globe className={cx("ml-1.5 h-3.5 w-3.5", dark ? "text-navy-300" : "text-ink-3")} />}
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          title={l.label}
          onClick={() => start(() => setLocaleAction(l.code))}
          className={cx(
            "rounded px-1.5 py-0.5 text-[12px] font-semibold transition-colors",
            locale === l.code ? (dark ? "bg-white text-navy-900" : "bg-navy-900 text-white") : dark ? "text-navy-200 hover:text-white" : "text-ink-3 hover:text-ink",
          )}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
