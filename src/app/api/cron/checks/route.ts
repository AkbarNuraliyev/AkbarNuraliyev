import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { withSystem, withTenant } from "@/lib/db";
import { parseSettings } from "@/lib/settings";
import { runChecks } from "@/server/services/checks";
import { dispatchPendingWebhooks } from "@/server/services/webhooks";

export const dynamic = "force-dynamic";

/**
 * Scheduled job (call every 10–15 minutes from a scheduler):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/checks
 * Runs operational checks for every active tenant, sends queued webhooks and
 * updates subscription states (past-due / cancelled at period end).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
  if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const tenants = await withSystem(async (tx) => {
    // subscription lifecycle
    await tx.subscription.updateMany({ where: { cancelAtPeriodEnd: true, currentPeriodEnd: { lt: now }, status: { not: "CANCELED" } }, data: { status: "CANCELED" } });
    const overdue = await tx.billingInvoice.findMany({ where: { status: "UNPAID", dueAt: { lt: now } }, select: { subscriptionId: true } });
    if (overdue.length) await tx.subscription.updateMany({ where: { id: { in: overdue.map((o) => o.subscriptionId) }, status: "ACTIVE" }, data: { status: "PAST_DUE" } });
    return tx.tenant.findMany({ where: { status: "ACTIVE" }, select: { id: true, timezone: true, settings: true } });
  });
  let alerts = 0;
  let webhooks = 0;
  for (const t of tenants) {
    const ctx = { tenantId: t.id, tz: t.timezone, settings: parseSettings(t.settings) };
    alerts += await withTenant(ctx, (tx) => runChecks(tx, ctx));
    webhooks += await dispatchPendingWebhooks(t.id);
  }
  return NextResponse.json({ tenants: tenants.length, alertsCreated: alerts, webhooksProcessed: webhooks, at: now.toISOString() });
}
