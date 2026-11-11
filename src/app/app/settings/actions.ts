"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { defineAction, zBool, zDate, zId, zNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseSettings } from "@/lib/settings";
import { audit, diff, validateBatchFormat } from "@/server/core";
import { changePlan, setCancelAtPeriodEnd } from "@/server/services/billing";

const orgSchema = z.object({
  name: zStr(120),
  legalName: zOptStr(200),
  taxId: zOptStr(20),
  address: zOptStr(300),
  phone: zOptStr(40),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")).transform((v) => v || null),
  timezone: zStr(60),
  currency: z.enum(["UZS", "USD", "EUR", "RUB", "KZT"]),
  locale: z.enum(["ru", "uz", "en"]),
  batchPrefix: zStr(12).transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9]+$/, "Use letters and digits only")),
  batchFormat: zStr(60),
});

export const updateOrganizationAction = defineAction({ permission: "settings.manage", schema: orgSchema }, async (ctx, input) => {
  const err = validateBatchFormat(input.batchFormat);
  if (err) throw new AppError(err, {}, "batchFormat");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    throw new AppError("Unknown time zone", {}, "timezone");
  }
  await withTenant(ctx, async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const after = await tx.tenant.update({ where: { id: ctx.tenantId }, data: input });
    await audit(tx, ctx, { action: "settings.update", entityType: "tenant", entityId: ctx.tenantId, summary: "Organization settings", changes: diff(before as never, after as never) });
  });
  return { ok: true, message: "Settings saved" };
});

const thresholdsSchema = z.object({
  chilledMinTempC: zNum({ min: -5, max: 10 }),
  chilledMaxTempC: zNum({ min: -5, max: 15 }),
  frozenTargetTempC: zNum({ min: -40, max: -5 }),
  frozenMaxTempC: zNum({ min: -40, max: -5 }),
  chilledShelfLifeHours: zNum({ min: 1, max: 720, int: true }),
  massBalanceTolerancePct: zNum({ min: 0.1, max: 20 }),
  inFullTolerancePct: zNum({ min: 0, max: 20 }),
  expiryWarningHours: zNum({ min: 1, max: 720, int: true }),
  forecastWeeks: zNum({ min: 2, max: 12, int: true }),
  forecastSafetyStockPct: zNum({ min: 0, max: 100 }),
  defaultPaymentTermsDays: zNum({ min: 0, max: 365, int: true }),
  showFarmOnPublicPage: zBool,
  publicPageMessage: zOptStr(300),
});

export const updateThresholdsAction = defineAction({ permission: "settings.manage", schema: thresholdsSchema }, async (ctx, input, fd) => {
  if (input.chilledMinTempC >= input.chilledMaxTempC) throw new AppError("Chilled minimum must be below maximum", {}, "chilledMinTempC");
  const seasonal: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const v = Number(String(fd.get(`season_${m}`) ?? "1").replace(",", "."));
    if (!Number.isFinite(v) || v < 0.3 || v > 3) throw new AppError("Seasonal factors must be between 0.3 and 3");
    seasonal.push(v);
  }
  await withTenant(ctx, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const before = parseSettings(t.settings);
    const next = { ...before, ...input, publicPageMessage: input.publicPageMessage ?? "", seasonalFactors: seasonal };
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
    await audit(tx, ctx, { action: "settings.update", entityType: "tenant", entityId: ctx.tenantId, summary: "Operational thresholds", changes: diff(before as never, next as never) });
  });
  return { ok: true, message: "Thresholds saved" };
});

const planSchema = z.object({ planCode: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]), billingCycle: z.enum(["MONTHLY", "YEARLY"]) });
export const changePlanAction = defineAction({ permission: "settings.billing", schema: planSchema, allowReadOnly: true }, async (ctx, input) => {
  if (ctx.tenant.isDemo) throw new AppError("The demo workspace subscription cannot be changed");
  const inv = await withTenant(ctx, (tx) => changePlan(tx, ctx, input));
  return { ok: true, message: "Plan changed. Invoice {n} issued — pay by bank transfer; access remains active during the trial or grace period.", params: { n: inv.number } };
});

const cancelSchema = z.object({ cancel: z.enum(["yes", "no"]) });
export const cancelSubscriptionAction = defineAction({ permission: "settings.billing", schema: cancelSchema, allowReadOnly: true }, async (ctx, input) => {
  if (ctx.tenant.isDemo) throw new AppError("The demo workspace subscription cannot be changed");
  await withTenant(ctx, (tx) => setCancelAtPeriodEnd(tx, ctx, input.cancel === "yes"));
  return { ok: true, message: input.cancel === "yes" ? "Subscription will end at the end of the current period" : "Subscription renewal resumed" };
});

const holidaySchema = z.object({ date: zDate, name: zStr(120), demandFactor: zNum({ min: 0.2, max: 5 }) });
export const addHolidayAction = defineAction({ permission: "settings.manage", schema: holidaySchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    await tx.holiday.upsert({
      where: { tenantId_date: { tenantId: ctx.tenantId, date: new Date(`${input.date}T00:00:00Z`) } },
      update: { name: input.name, demandFactor: input.demandFactor },
      create: { tenantId: ctx.tenantId, date: new Date(`${input.date}T00:00:00Z`), name: input.name, demandFactor: input.demandFactor },
    });
    await audit(tx, ctx, { action: "holiday.upsert", entityType: "holiday", summary: `${input.date} ${input.name} ×${input.demandFactor}` });
  });
  return { ok: true, message: "Holiday saved" };
});

const delSchema = z.object({ id: zId });
export const deleteHolidayAction = defineAction({ permission: "settings.manage", schema: delSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const h = await tx.holiday.delete({ where: { id: input.id } });
    await audit(tx, ctx, { action: "holiday.delete", entityType: "holiday", entityId: h.id, summary: h.name });
  });
  return { ok: true, message: "Holiday removed" };
});
