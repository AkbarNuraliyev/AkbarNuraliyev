import { Tabs } from "@/components/ui/basic";
import type { TFunc } from "@/lib/i18n";

export function LogisticsTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "shipments", href: "/app/logistics", label: t("Shipments") },
        { key: "temperature", href: "/app/logistics/temperature", label: t("Cold chain") },
        { key: "vehicles", href: "/app/logistics/vehicles", label: t("Vehicles") },
        { key: "drivers", href: "/app/logistics/drivers", label: t("Drivers") },
        { key: "routes", href: "/app/logistics/routes", label: t("Routes") },
        { key: "driver", href: "/app/logistics/driver", label: t("Driver app") },
      ]}
    />
  );
}
