import { ShieldOff } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { EmptyState, LinkButton } from "@/components/ui/basic";

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ permission?: string }> }) {
  const ctx = await requireApp();
  const { permission } = await searchParams;
  return (
    <EmptyState
      icon={<ShieldOff className="h-8 w-8" />}
      title={ctx.t("You do not have access to this section")}
      description={`${ctx.t("Your role does not include the required permission. Ask a Company Admin to update your role or department.")}${permission ? ` (${permission})` : ""}`}
      action={<LinkButton href="/app">{ctx.t("Back to overview")}</LinkButton>}
    />
  );
}
