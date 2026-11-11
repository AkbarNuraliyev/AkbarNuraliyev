"use client";

import { Printer } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { buttonClass } from "@/components/ui/basic";

export function PrintButton({ label = "Print" }: { label?: string }) {
  const t = useT();
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("primary", "md")}>
      <Printer className="h-4 w-4" /> {t(label)}
    </button>
  );
}
