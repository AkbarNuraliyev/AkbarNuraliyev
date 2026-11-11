import type { Tx } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { round } from "@/lib/format";
import { addDaysKey, dateOnly, localDateKey, weekdayOfKey, zonedMidnight } from "@/lib/tz";
import { audit, nowOf, type ServiceCtx } from "../core";
import { EPS } from "./inventory";

export const FORECAST_METHOD =
  "Statistical baseline: recent level (average daily demand of the last 14 days) × day-of-week index (average demand on the same weekday ÷ average daily demand over the history window) × monthly seasonal factor × holiday factor. B2B demand is never forecast below orders already booked for the date. No machine-learning model is used.";

export interface ForecastLine {
  productId: string;
  sku: string;
  name: string;
  storageType: string;
  shelfLifeHours: number;
  targetYieldPct: number | null;
  history: { recentAvg: number; weekdayAvg: number; windowAvg: number; days: number };
  dowIndex: number;
  seasonalFactor: number;
  holidayFactor: number;
  b2bStat: number;
  retailStat: number;
  bookedOrdersKg: number;
  confirmedOrdersKg: number;
  forecastKg: number;
  usableStockKg: number;
  atRiskKg: number;
  safetyKg: number;
  recommendedKg: number;
  adjustedKg: number | null;
  planStatus: string | null;
  expectedShortageKg: number;
  expectedSurplusKg: number;
  liveWeightRequiredKg: number | null;
  assumptions: string[];
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export async function forecastForDate(tx: Tx, ctx: ServiceCtx, targetKey: string) {
  const s = ctx.settings;
  const now = nowOf(ctx);
  const todayKey = localDateKey(now, ctx.tz);
  const weeks = Math.max(2, Math.min(12, s.forecastWeeks));
  const lastFull = addDaysKey(todayKey, -1);
  const histFrom = addDaysKey(lastFull, -(weeks * 7 - 1));
  const days: string[] = [];
  for (let k = histFrom; k <= lastFull; k = addDaysKey(k, 1)) days.push(k);
  const targetWd = weekdayOfKey(targetKey);
  const fromTs = zonedMidnight(histFrom, ctx.tz);
  const toTs = zonedMidnight(addDaysKey(lastFull, 1), ctx.tz);

  const [b2bRows, retailRows, products, booked, holiday, plans] = await Promise.all([
    tx.$queryRaw<{ day: string; productId: string; v: number }[]>`
      SELECT to_char(o."requestedDeliveryDate", 'YYYY-MM-DD') AS day, i."productId", SUM(i."quantityKg")::float AS v
      FROM order_items i JOIN orders o ON o.id = i."orderId"
      WHERE o."requestedDeliveryDate" >= ${dateOnly(histFrom)} AND o."requestedDeliveryDate" <= ${dateOnly(lastFull)} AND o.status <> 'CANCELLED'
      GROUP BY 1, 2`,
    tx.$queryRaw<{ day: string; productId: string; v: number }[]>`
      SELECT to_char(("soldAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.tz}, 'YYYY-MM-DD') AS day, "productId", SUM("quantityKg")::float AS v
      FROM sales WHERE "soldAt" >= ${fromTs} AND "soldAt" < ${toTs} GROUP BY 1, 2`,
    tx.product.findMany({ where: { isActive: true }, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }] }),
    tx.orderItem.groupBy({
      by: ["productId"],
      where: { order: { requestedDeliveryDate: dateOnly(targetKey), status: { not: "CANCELLED" } } },
      _sum: { quantityKg: true },
    }),
    tx.holiday.findUnique({ where: { tenantId_date: { tenantId: ctx.tenantId, date: dateOnly(targetKey) } } }),
    tx.productionPlan.findMany({ where: { planDate: dateOnly(targetKey) } }),
  ]);
  const confirmed = await tx.orderItem.groupBy({
    by: ["productId"],
    where: { order: { requestedDeliveryDate: dateOnly(targetKey), status: { notIn: ["CANCELLED", "NEW"] } } },
    _sum: { quantityKg: true },
  });

  const validUntil = zonedMidnight(addDaysKey(targetKey, 1), ctx.tz);
  const lots = await tx.inventory.findMany({
    where: { quantityKg: { gt: EPS }, status: "AVAILABLE", expiryDate: { gt: now } },
    select: { productId: true, quantityKg: true, reservedKg: true, expiryDate: true, allocations: { where: { status: { in: ["RESERVED", "PICKED"] } }, select: { quantityKg: true, orderItem: { select: { order: { select: { requestedDeliveryDate: true } } } } } } },
  });

  const month = Number(targetKey.slice(5, 7));
  const seasonalFactor = s.seasonalFactors[month - 1] ?? 1;
  const holidayFactor = holiday?.demandFactor ?? 1;
  const recentDays = days.slice(-14);
  const sameWd = days.filter((d) => weekdayOfKey(d) === targetWd);

  const series = (rows: { day: string; productId: string; v: number }[], productId: string) => {
    const m = new Map(rows.filter((r) => r.productId === productId).map((r) => [r.day, Number(r.v)]));
    return (ds: string[]) => ds.map((d) => m.get(d) ?? 0);
  };

  const lines: ForecastLine[] = [];
  for (const p of products) {
    const b2b = series(b2bRows, p.id);
    const ret = series(retailRows, p.id);
    const total = (ds: string[]) => b2b(ds).map((v, i) => v + ret(ds)[i]);
    const windowAvg = avg(total(days));
    const bookedKg = booked.find((b) => b.productId === p.id)?._sum.quantityKg ?? 0;
    if (windowAvg <= EPS && bookedKg <= EPS) continue;
    const weekdayAvg = avg(total(sameWd));
    const dowIndex = windowAvg > EPS ? weekdayAvg / windowAvg : 1;
    const factor = dowIndex * seasonalFactor * holidayFactor;
    const b2bStat = avg(b2b(recentDays)) * factor;
    const retailStat = avg(ret(recentDays)) * factor;
    const confirmedKg = confirmed.find((b) => b.productId === p.id)?._sum.quantityKg ?? 0;
    const b2bForecast = Math.max(b2bStat, bookedKg);
    const forecastKg = b2bForecast + retailStat;

    let usable = 0;
    let atRisk = 0;
    for (const l of lots.filter((x) => x.productId === p.id)) {
      const reservedForTarget = l.allocations
        .filter((a) => localDateKey(a.orderItem.order.requestedDeliveryDate, "UTC") === targetKey)
        .reduce((acc, a) => acc + a.quantityKg, 0);
      const free = Math.max(0, l.quantityKg - l.reservedKg);
      if (l.expiryDate > validUntil) usable += free + reservedForTarget;
      else if (l.expiryDate > now) atRisk += free;
    }
    const safetyKg = forecastKg * (s.forecastSafetyStockPct / 100);
    const recommendedKg = Math.max(0, forecastKg + safetyKg - usable);
    const plan = plans.find((x) => x.productId === p.id);
    const planned = plan ? plan.adjustedKg : recommendedKg;
    const liveWeight = p.targetYieldPct ? recommendedKg / (p.targetYieldPct / 100) : null;
    const assumptions = [
      `History window ${histFrom} … ${lastFull} (${days.length} days); recent level from last ${recentDays.length} days`,
      `Day-of-week index ${round(dowIndex, 2)} (${sameWd.length} same-weekday observations)`,
      `Seasonal factor for month ${month}: ${seasonalFactor} (configured in Settings)`,
      holiday ? `Holiday ${holiday.name}: factor ${holiday.demandFactor}` : "No holiday on target date (factor 1.0)",
      `Booked orders ${round(bookedKg, 1)} kg (confirmed ${round(confirmedKg, 1)} kg) — B2B forecast is never below booked orders`,
      `Safety stock ${s.forecastSafetyStockPct}% of forecast`,
      `Usable stock counts only lots valid through the end of ${targetKey}; ${round(atRisk, 1)} kg expires earlier`,
      `Shelf life ${p.shelfLifeHours} h${p.targetYieldPct ? `; target yield ${p.targetYieldPct}% of live weight` : ""}`,
    ];
    lines.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      storageType: p.storageType,
      shelfLifeHours: p.shelfLifeHours,
      targetYieldPct: p.targetYieldPct,
      history: { recentAvg: round(avg(total(recentDays)), 2), weekdayAvg: round(weekdayAvg, 2), windowAvg: round(windowAvg, 2), days: days.length },
      dowIndex: round(dowIndex, 3),
      seasonalFactor,
      holidayFactor,
      b2bStat: round(b2bStat, 1),
      retailStat: round(retailStat, 1),
      bookedOrdersKg: round(bookedKg, 1),
      confirmedOrdersKg: round(confirmedKg, 1),
      forecastKg: round(forecastKg, 1),
      usableStockKg: round(usable, 1),
      atRiskKg: round(atRisk, 1),
      safetyKg: round(safetyKg, 1),
      recommendedKg: round(recommendedKg, 1),
      adjustedKg: plan ? round(plan.adjustedKg, 1) : null,
      planStatus: plan?.status ?? null,
      expectedShortageKg: round(Math.max(0, forecastKg - usable - planned), 1),
      expectedSurplusKg: round(Math.max(0, usable + planned - forecastKg), 1),
      liveWeightRequiredKg: liveWeight !== null ? round(liveWeight, 0) : null,
      assumptions,
    });
  }
  const binding = lines.filter((l) => l.liveWeightRequiredKg !== null).sort((a, b) => (b.liveWeightRequiredKg ?? 0) - (a.liveWeightRequiredKg ?? 0))[0];
  const avgBird = await tx.rawMaterialReceipt.aggregate({ where: { receivedAt: { gte: zonedMidnight(addDaysKey(todayKey, -14), ctx.tz) } }, _sum: { netWeightKg: true, birdsReceived: true } });
  const avgBirdKg = avgBird._sum.birdsReceived ? (avgBird._sum.netWeightKg ?? 0) / avgBird._sum.birdsReceived : null;
  return {
    targetKey,
    method: FORECAST_METHOD,
    window: { from: histFrom, to: lastFull, weeks },
    seasonalFactor,
    holiday: holiday ? { name: holiday.name, factor: holiday.demandFactor } : null,
    lines,
    totals: {
      forecastKg: round(lines.reduce((a, l) => a + l.forecastKg, 0), 1),
      bookedKg: round(lines.reduce((a, l) => a + l.bookedOrdersKg, 0), 1),
      usableKg: round(lines.reduce((a, l) => a + l.usableStockKg, 0), 1),
      recommendedKg: round(lines.reduce((a, l) => a + l.recommendedKg, 0), 1),
      atRiskKg: round(lines.reduce((a, l) => a + l.atRiskKg, 0), 1),
      shortageKg: round(lines.reduce((a, l) => a + l.expectedShortageKg, 0), 1),
      surplusKg: round(lines.reduce((a, l) => a + l.expectedSurplusKg, 0), 1),
    },
    liveWeight: binding
      ? { kg: binding.liveWeightRequiredKg!, bindingProduct: binding.name, avgBirdKg: avgBirdKg ? round(avgBirdKg, 3) : null, birds: avgBirdKg ? Math.ceil(binding.liveWeightRequiredKg! / avgBirdKg) : null }
      : null,
  };
}

export async function savePlan(
  tx: Tx,
  ctx: ServiceCtx,
  targetKey: string,
  adjustments: Record<string, number>,
  approve: boolean,
) {
  const fc = await forecastForDate(tx, ctx, targetKey);
  let count = 0;
  for (const l of fc.lines) {
    const adjusted = adjustments[l.productId] ?? l.adjustedKg ?? l.recommendedKg;
    if (!Number.isFinite(adjusted) || adjusted < 0) continue;
    const data = {
      forecastKg: l.forecastKg,
      confirmedOrdersKg: l.confirmedOrdersKg,
      availableStockKg: l.usableStockKg,
      recommendedKg: l.recommendedKg,
      adjustedKg: round(adjusted, 1),
      assumptions: { method: fc.method, lines: l.assumptions, manualOverride: Math.abs(adjusted - l.recommendedKg) > 0.05 } as unknown as Prisma.InputJsonValue,
      status: approve ? ("APPROVED" as const) : ("DRAFT" as const),
      createdById: ctx.userId ?? null,
    };
    await tx.productionPlan.upsert({
      where: { tenantId_planDate_productId: { tenantId: ctx.tenantId, planDate: dateOnly(targetKey), productId: l.productId } },
      update: data,
      create: { tenantId: ctx.tenantId, planDate: dateOnly(targetKey), productId: l.productId, ...data },
    });
    count++;
  }
  await audit(tx, ctx, { action: approve ? "plan.approve" : "plan.save", entityType: "production_plan", summary: `${targetKey}: ${count} product(s)` });
  return count;
}

/** Plan vs actual production for past plan dates. */
export async function planVsActual(tx: Tx, ctx: ServiceCtx, fromKey: string, toKey: string) {
  const plans = await tx.productionPlan.findMany({ where: { planDate: { gte: dateOnly(fromKey), lte: dateOnly(toKey) } }, include: { product: true } });
  const rows = await tx.$queryRaw<{ day: string; productId: string; v: number }[]>`
    SELECT to_char(("producedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.tz}, 'YYYY-MM-DD') AS day, "productId", SUM("weightKg")::float AS v
    FROM production_outputs WHERE "producedAt" >= ${zonedMidnight(fromKey, ctx.tz)} AND "producedAt" < ${zonedMidnight(addDaysKey(toKey, 1), ctx.tz)} AND "productId" IS NOT NULL
    GROUP BY 1, 2`;
  const byDay = new Map<string, { day: string; planned: number; actual: number; forecast: number }>();
  for (const p of plans) {
    const day = p.planDate.toISOString().slice(0, 10);
    const e = byDay.get(day) ?? { day, planned: 0, actual: 0, forecast: 0 };
    e.planned += p.adjustedKg;
    e.forecast += p.forecastKg;
    e.actual += rows.find((r) => r.day === day && r.productId === p.productId)?.v ?? 0;
    byDay.set(day, e);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((e) => ({ ...e, planned: round(e.planned, 1), actual: round(e.actual, 1), forecast: round(e.forecast, 1) }));
}
