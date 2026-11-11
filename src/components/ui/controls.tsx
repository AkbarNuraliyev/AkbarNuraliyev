"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx } from "./basic";

function useParamUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    p.delete("page");
    const s = p.toString();
    start(() => router.replace(`${pathname}${s ? "?" + s : ""}`, { scroll: false }));
  };
  return { set, sp, pending };
}

export function SearchBox({ placeholder = "Search…", param = "q", className }: { placeholder?: string; param?: string; className?: string }) {
  const t = useT();
  const { set, sp, pending } = useParamUpdater();
  const [value, setValue] = useState(sp.get(param) ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => set({ [param]: value.trim() || null }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cx("relative w-full sm:w-72", className)}>
      {pending ? (
        <Loader2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-3" />
      ) : (
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
      )}
      <input type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t(placeholder)} className="input pl-9" aria-label={t(placeholder)} />
    </div>
  );
}

export function FilterSelect({
  param,
  options,
  allLabel = "All",
  className,
  label,
  translate = true,
}: {
  param: string;
  options: { value: string; label: string }[];
  allLabel?: string;
  className?: string;
  label?: string;
  translate?: boolean;
}) {
  const t = useT();
  const { set, sp } = useParamUpdater();
  return (
    <select
      aria-label={label ? t(label) : param}
      className={cx("input w-auto min-w-[140px] pr-8", className)}
      value={sp.get(param) ?? ""}
      onChange={(e) => set({ [param]: e.target.value || null })}
    >
      <option value="">{label ? `${t(label)}: ${t(allLabel)}` : t(allLabel)}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {translate ? t(o.label) : o.label}
        </option>
      ))}
    </select>
  );
}

export function RangeFilter({ options = ["today", "7d", "30d", "90d"], showCustom = true }: { options?: string[]; showCustom?: boolean }) {
  const t = useT();
  const { set, sp, pending } = useParamUpdater();
  const current = sp.get("from") && sp.get("to") ? "custom" : sp.get("range") ?? options[0];
  const labels: Record<string, string> = { today: "Today", yesterday: "Yesterday", "7d": "7 days", "30d": "30 days", "90d": "90 days" };
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-line bg-white p-0.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => set({ range: o, from: null, to: null })}
            className={cx("rounded px-2.5 py-1 text-[13px] font-medium transition-colors", current === o ? "bg-navy-900 text-white" : "text-ink-2 hover:bg-slate-100")}
          >
            {t(labels[o] ?? o)}
          </button>
        ))}
      </div>
      {showCustom && (
        <div className="flex items-center gap-1.5">
          <input type="date" className="input h-8 w-[140px] py-1 text-[13px]" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("From")} />
          <span className="text-ink-3">–</span>
          <input type="date" className="input h-8 w-[140px] py-1 text-[13px]" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("To")} />
          <button
            type="button"
            disabled={!from || !to || from > to}
            onClick={() => set({ from, to, range: null })}
            className="h-8 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {t("Apply")}
          </button>
        </div>
      )}
      {pending && <Loader2 className="h-4 w-4 animate-spin text-ink-3" />}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}
