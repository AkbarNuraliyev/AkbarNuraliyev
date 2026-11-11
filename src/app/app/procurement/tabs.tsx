import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function ProcurementTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "suppliers", href: "/app/procurement", label: t("Suppliers") },
        { key: "farms", href: "/app/procurement/farms", label: t("Farms") },
        { key: "performance", href: "/app/procurement/performance", label: t("Supplier performance") },
      ]}
    />
  );
}
