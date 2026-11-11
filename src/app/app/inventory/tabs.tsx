import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function InventoryTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "stock", href: "/app/inventory", label: t("Stock") },
        { key: "movements", href: "/app/inventory/movements", label: t("Movements") },
        { key: "transfers", href: "/app/inventory/transfers", label: t("Transfers") },
        { key: "stocktakes", href: "/app/inventory/stocktakes", label: t("Stocktaking") },
        { key: "warehouses", href: "/app/inventory/warehouses", label: t("Warehouses & chambers") },
        { key: "scan", href: "/app/inventory/scan", label: t("Scan / lookup") },
      ]}
    />
  );
}
