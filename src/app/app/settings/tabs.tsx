import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function SettingsTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "general", href: "/app/settings", label: t("Organization") },
        { key: "subscription", href: "/app/settings/subscription", label: t("Subscription & billing") },
        { key: "holidays", href: "/app/settings/holidays", label: t("Holidays") },
        { key: "audit", href: "/app/settings/audit", label: t("Audit log") },
      ]}
    />
  );
}
