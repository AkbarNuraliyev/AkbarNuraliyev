import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function ProductTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "catalog", href: "/app/products", label: t("Product catalog") },
        { key: "categories", href: "/app/products/categories", label: t("Categories") },
        { key: "labels", href: "/app/products/labels", label: t("Labels & templates") },
      ]}
    />
  );
}
