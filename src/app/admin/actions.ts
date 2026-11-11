"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { AppError, type ActionResult } from "@/lib/errors";
import { formToObject, isNextControlError, zodErrors } from "@/lib/action";
import { getI18n } from "@/lib/i18n/server";
import { FEATURES } from "@/lib/modules";
import { confirmBillingPayment } from "@/server/services/billing";

type Handler<S extends z.ZodTypeAny> = (admin: { id: string; email: string }, input: z.infer<S>, fd: FormData) => Promise<ActionResult | void>;

/** Platform-level actions: only Super Admins; runs in system context (audited). */
function defineAdminAction<S extends z.ZodTypeAny>(schema: S, handler: Handler<S>) {
  return async (_prev: ActionResult | null, fd: FormData): Promise<ActionResult> => {
    const { t } = await getI18n();
    try {
      const s = await getSession();
      if (!s?.user.isSuperAdmin) throw new AppError("Super Admin access required");
      const parsed = schema.safeParse(formToObject(fd));
      if (!parsed.success) return { ok: false, message: t("Please correct the highlighted fields."), errors: zodErrors(parsed.error, t) };
      const r = (await handler({ id: s.user.id, email: s.user.email }, parsed.data, fd)) ?? { ok: true };
      if (r.message) r.message = t(r.message, r.params);
      delete r.params;
      if (r.ok) revalidatePath("/admin", "layout");
      return r;
    } catch (e) {
      if (isNextControlError(e)) throw e;
      if (e instanceof AppError) return { ok: false, message: t(e.template, e.params) };
      console.error("[admin action]", e);
      return { ok: false, message: t("Something went wrong. The operation was not saved.") };
    }
  };
}

const suspendSchema = z.object({ tenantId: z.string(), status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().optional() });
export const setTenantStatusAction = defineAdminAction(suspendSchema, async (admin, input) => {
  await withSystem(async (tx) => {
    const t = await tx.tenant.update({
      where: { id: input.tenantId },
      data: { status: input.status, suspendedAt: input.status === "SUSPENDED" ? new Date() : null, suspendReason: input.status === "SUSPENDED" ? input.reason ?? "Suspended by platform operator" : null },
    });
    if (input.status === "SUSPENDED") await tx.session.deleteMany({ where: { tenantId: t.id } });
    await tx.auditLog.create({ data: { tenantId: t.id, userId: admin.id, userEmail: admin.email, action: input.status === "SUSPENDED" ? "platform.tenant_suspend" : "platform.tenant_activate", entityType: "tenant", entityId: t.id, summary: input.reason ?? null } });
  });
  return { ok: true, message: input.status === "SUSPENDED" ? "Organization suspended" : "Organization activated" };
});

const subSchema = z.object({ tenantId: z.string(), planId: z.string(), status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]), customMaxUsers: z.string().optional(), trialEndsAt: z.string().optional() });
export const updateSubscriptionAction = defineAdminAction(subSchema, async (admin, input) => {
  await withSystem(async (tx) => {
    const before = await tx.subscription.findUniqueOrThrow({ where: { tenantId: input.tenantId }, include: { plan: true } });
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: input.planId } });
    await tx.subscription.update({
      where: { id: before.id },
      data: {
        planId: plan.id,
        status: input.status,
        customMaxUsers: input.customMaxUsers ? Number(input.customMaxUsers) : null,
        trialEndsAt: input.trialEndsAt ? new Date(`${input.trialEndsAt}T23:59:59Z`) : input.status === "TRIALING" ? before.trialEndsAt : null,
      },
    });
    await tx.auditLog.create({ data: { tenantId: input.tenantId, userId: admin.id, userEmail: admin.email, action: "platform.subscription_update", entityType: "subscription", entityId: before.id, summary: `${before.plan.code}/${before.status} → ${plan.code}/${input.status}` } });
  });
  return { ok: true, message: "Subscription updated" };
});

const featSchema = z.object({ tenantId: z.string() });
export const saveFeatureOverridesAction = defineAdminAction(featSchema, async (admin, input, fd) => {
  await withSystem(async (tx) => {
    await tx.tenantFeatureOverride.deleteMany({ where: { tenantId: input.tenantId } });
    const rows: { tenantId: string; feature: string; enabled: boolean }[] = [];
    for (const f of FEATURES) {
      const v = fd.get(`f_${f.key}`);
      if (v === "on") rows.push({ tenantId: input.tenantId, feature: f.key, enabled: true });
      if (v === "off") rows.push({ tenantId: input.tenantId, feature: f.key, enabled: false });
    }
    if (rows.length) await tx.tenantFeatureOverride.createMany({ data: rows });
    await tx.auditLog.create({ data: { tenantId: input.tenantId, userId: admin.id, userEmail: admin.email, action: "platform.feature_overrides", entityType: "tenant", entityId: input.tenantId, summary: rows.map((r) => `${r.feature}=${r.enabled ? "on" : "off"}`).join(", ") || "cleared" } });
  });
  return { ok: true, message: "Feature availability saved" };
});

const planSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  priceMonthly: z.coerce.number().min(0),
  priceYearly: z.coerce.number().min(0),
  maxUsers: z.string().optional(),
  maxFacilities: z.string().optional(),
  maxWarehouses: z.string().optional(),
  maxRetailLocations: z.string().optional(),
  trialDays: z.coerce.number().int().min(0).max(90),
  isActive: z.string().optional(),
  isPublic: z.string().optional(),
});
const lim = (v?: string) => (v === undefined || v === "" ? null : Math.max(0, Math.floor(Number(v))));
export const updatePlanAction = defineAdminAction(planSchema, async (admin, input, fd) => {
  const features = FEATURES.map((f) => f.key).filter((k) => fd.get(`feat_${k}`) === "on");
  await withSystem(async (tx) => {
    const p = await tx.plan.update({
      where: { id: input.id },
      data: {
        name: input.name,
        description: input.description ?? null,
        priceMonthly: input.priceMonthly,
        priceYearly: input.priceYearly,
        maxUsers: lim(input.maxUsers),
        maxFacilities: lim(input.maxFacilities),
        maxWarehouses: lim(input.maxWarehouses),
        maxRetailLocations: lim(input.maxRetailLocations),
        trialDays: input.trialDays,
        isActive: input.isActive === "on",
        isPublic: input.isPublic === "on",
        features,
      },
    });
    await tx.auditLog.create({ data: { userId: admin.id, userEmail: admin.email, action: "platform.plan_update", entityType: "plan", entityId: p.id, summary: `${p.code}: ${input.priceMonthly}/${input.priceYearly} UZS, ${features.length} features` } });
  });
  return { ok: true, message: "Plan saved" };
});

const paySchema = z.object({ invoiceId: z.string(), method: z.enum(["BANK_TRANSFER", "CASH", "OTHER"]), reference: z.string().min(3, "Enter the bank / payment reference") });
export const confirmPaymentAction = defineAdminAction(paySchema, async (admin, input) => {
  await withSystem((tx) => confirmBillingPayment(tx, { ...input, confirmedBy: admin.email }));
  return { ok: true, message: "Payment confirmed — subscription activated" };
});

const voidSchema = z.object({ invoiceId: z.string() });
export const voidInvoiceAction = defineAdminAction(voidSchema, async (admin, input) => {
  await withSystem(async (tx) => {
    const inv = await tx.billingInvoice.update({ where: { id: input.invoiceId }, data: { status: "VOID" } });
    await tx.auditLog.create({ data: { tenantId: inv.tenantId, userId: admin.id, userEmail: admin.email, action: "platform.invoice_void", entityType: "billing_invoice", entityId: inv.id, summary: inv.number } });
  });
  return { ok: true, message: "Invoice voided" };
});
