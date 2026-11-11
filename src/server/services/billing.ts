import type { Tx } from "@/lib/prisma";
import { AppError, assert } from "@/lib/errors";
import { num } from "@/lib/format";
import { addDays } from "@/lib/tz";
import { audit, nowOf, type ServiceCtx } from "../core";

export type LimitKey = "users" | "facilities" | "warehouses" | "retail";

export async function usage(tx: Tx) {
  const [users, invites, facilities, warehouses, retail] = await Promise.all([
    tx.membership.count({ where: { status: "ACTIVE", role: { isPortal: false } } }),
    tx.invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, role: { isPortal: false } } }),
    tx.facility.count({ where: { isActive: true } }),
    tx.warehouse.count({ where: { isActive: true, type: { not: "RETAIL" } } }),
    tx.retailLocation.count({ where: { isActive: true } }),
  ]);
  return { users: users + invites, activeUsers: users, pendingInvites: invites, facilities, warehouses, retail };
}

export async function planLimits(tx: Tx, tenantId: string) {
  const sub = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  assert(sub, "No subscription found");
  return {
    users: sub.customMaxUsers ?? sub.plan.maxUsers,
    facilities: sub.plan.maxFacilities,
    warehouses: sub.plan.maxWarehouses,
    retail: sub.plan.maxRetailLocations,
    plan: sub.plan,
  };
}

const LIMIT_LABEL: Record<LimitKey, string> = { users: "users", facilities: "production facilities", warehouses: "warehouses", retail: "retail locations" };

/** Throws when creating one more resource would exceed the plan limit. */
export async function assertWithinLimit(tx: Tx, tenantId: string, key: LimitKey) {
  const [u, l] = await Promise.all([usage(tx), planLimits(tx, tenantId)]);
  const limit = l[key];
  if (limit === null || limit === undefined) return;
  if (u[key] + 1 > limit)
    throw new AppError("Your {plan} plan allows {limit} {what}. Upgrade the plan to add more.", { plan: l.plan.name, limit, what: LIMIT_LABEL[key] });
}

async function invoiceNumber(tx: Tx) {
  const n = await tx.billingInvoice.count();
  return `PO-${new Date().getUTCFullYear()}-${String(n + 1).padStart(6, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** Changes the plan. Downgrades are refused while current usage exceeds the new limits. */
export async function changePlan(tx: Tx, ctx: ServiceCtx, input: { planCode: string; billingCycle: "MONTHLY" | "YEARLY" }) {
  const sub = await tx.subscription.findUnique({ where: { tenantId: ctx.tenantId }, include: { plan: true } });
  assert(sub, "No subscription found");
  const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
  assert(plan && plan.isActive, "Plan not available");
  const u = await usage(tx);
  const checks: [LimitKey, number | null][] = [
    ["users", sub.customMaxUsers ?? plan.maxUsers],
    ["facilities", plan.maxFacilities],
    ["warehouses", plan.maxWarehouses],
    ["retail", plan.maxRetailLocations],
  ];
  for (const [k, lim] of checks) {
    if (lim !== null && u[k] > lim)
      throw new AppError("Cannot switch to {plan}: you use {used} {what} but the plan allows {limit}. Deactivate some first.", { plan: plan.name, used: u[k], limit: lim, what: LIMIT_LABEL[k] });
  }
  const now = nowOf(ctx);
  const sameCycle = sub.planId === plan.id && sub.billingCycle === input.billingCycle;
  if (sameCycle && sub.status === "ACTIVE") throw new AppError("You are already on this plan");
  const periodEnd = input.billingCycle === "YEARLY" ? addDays(now, 365) : addDays(now, 30);
  const inTrial = sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt > now;
  await tx.subscription.update({
    where: { id: sub.id },
    data: { planId: plan.id, billingCycle: input.billingCycle, cancelAtPeriodEnd: false },
  });
  const amount = input.billingCycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
  const start = inTrial && sub.trialEndsAt ? sub.trialEndsAt : now;
  const invoice = await tx.billingInvoice.create({
    data: {
      tenantId: ctx.tenantId,
      subscriptionId: sub.id,
      number: await invoiceNumber(tx),
      description: `${plan.name} plan — ${input.billingCycle === "YEARLY" ? "12 months" : "1 month"}`,
      amount,
      periodStart: start,
      periodEnd: input.billingCycle === "YEARLY" ? addDays(start, 365) : addDays(start, 30),
      dueAt: addDays(now, 7),
      issuedAt: now,
    },
  });
  void periodEnd;
  await audit(tx, ctx, {
    action: "subscription.change_plan",
    entityType: "subscription",
    entityId: sub.id,
    summary: `${sub.plan.name} → ${plan.name} (${input.billingCycle}); invoice ${invoice.number} ${num(amount)} UZS`,
    changes: { plan: { from: sub.plan.code, to: plan.code } },
  });
  return invoice;
}

export async function setCancelAtPeriodEnd(tx: Tx, ctx: ServiceCtx, cancel: boolean) {
  const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
  await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: cancel } });
  await audit(tx, ctx, { action: cancel ? "subscription.cancel" : "subscription.resume", entityType: "subscription", entityId: sub.id });
}

/** Super-admin confirmation of a received payment (bank transfer / manual). Activates the subscription. */
export async function confirmBillingPayment(tx: Tx, input: { invoiceId: string; method: string; reference: string; confirmedBy: string }) {
  const inv = await tx.billingInvoice.findUnique({ where: { id: input.invoiceId }, include: { subscription: true } });
  assert(inv, "Invoice not found");
  if (inv.status !== "UNPAID") throw new AppError("Invoice is not unpaid");
  assert(input.reference.length >= 3, "Enter the bank / payment reference");
  const now = new Date();
  await tx.billingInvoice.update({
    where: { id: inv.id },
    data: { status: "PAID", paidAt: now, paymentMethod: input.method, paymentRef: input.reference, confirmedBy: input.confirmedBy },
  });
  await tx.subscription.update({
    where: { id: inv.subscriptionId },
    data: { status: "ACTIVE", trialEndsAt: null, currentPeriodStart: inv.periodStart, currentPeriodEnd: inv.periodEnd },
  });
  await tx.auditLog.create({
    data: { tenantId: inv.tenantId, action: "billing.payment_confirmed", entityType: "billing_invoice", entityId: inv.id, userEmail: input.confirmedBy, summary: `${inv.number}: ${input.method} ${input.reference}` },
  });
}
