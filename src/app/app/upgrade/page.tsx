import { Lock } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { FEATURES } from "@/lib/modules";
import { EmptyState, LinkButton } from "@/components/ui/basic";

export default async function Upgrade({ searchParams }: { searchParams: Promise<{ feature?: string }> }) {
  const ctx = await requireApp();
  const { feature } = await searchParams;
  const f = FEATURES.find((x) => x.key === feature);
  return (
    <EmptyState
      icon={<Lock className="h-8 w-8" />}
      title={ctx.t("{feature} is not included in your plan", { feature: ctx.t(f?.label ?? "This module") })}
      description={ctx.t("Your current plan is {plan}. Upgrade to unlock this module — your data and settings are kept.", { plan: ctx.t(ctx.session.plan?.name ?? "—") })}
      action={
        ctx.can("settings.billing") ? (
          <LinkButton href="/app/settings/subscription" variant="primary">{ctx.t("Compare plans and upgrade")}</LinkButton>
        ) : (
          <span className="text-[13px] text-ink-3">{ctx.t("Ask the workspace owner to upgrade the plan.")}</span>
        )
      }
    />
  );
}
