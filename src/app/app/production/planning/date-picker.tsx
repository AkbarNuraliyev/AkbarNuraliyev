"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";

export function DatePicker({ value, min }: { value: string; min?: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-3">{t("Plan date")}</span>
      <input type="date" className="input h-9 w-44" defaultValue={value} min={min} onChange={(e) => e.target.value && router.replace(`?date=${e.target.value}`)} />
    </label>
  );
}
