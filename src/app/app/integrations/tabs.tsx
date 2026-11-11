import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function IntegrationTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "providers", href: "/app/integrations", label: t("Connectors") },
        { key: "api", href: "/app/integrations/api", label: t("REST API & keys") },
        { key: "webhooks", href: "/app/integrations/webhooks", label: t("Webhooks") },
      ]}
    />
  );
}
