import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function ProductionTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "shifts", href: "/app/production", label: t("Shifts & yields") },
        { key: "planning", href: "/app/production/planning", label: t("Demand forecast & planning") },
        { key: "lines", href: "/app/production/lines", label: t("Facilities & lines") },
      ]}
    />
  );
}
