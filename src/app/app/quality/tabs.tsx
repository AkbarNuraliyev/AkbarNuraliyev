import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function QualityTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "records", href: "/app/quality", label: t("Inspections & records") },
        { key: "nc", href: "/app/quality/nonconformities", label: t("Non-conformities & CAPA") },
        { key: "checklists", href: "/app/quality/checklists", label: t("Checklists (HACCP)") },
      ]}
    />
  );
}
