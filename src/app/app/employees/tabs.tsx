import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function EmployeeTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "members", href: "/app/employees", label: t("Team members") },
        { key: "roles", href: "/app/employees/roles", label: t("Roles, permissions & departments") },
        { key: "training", href: "/app/employees/training", label: t("Training") },
      ]}
    />
  );
}
