import type { Tx } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { num, pct, round } from "@/lib/format";
import { addDaysKey, addHours, dateOnly, localDateKey, zonedMidnight } from "@/lib/tz";
import { EPS } from "./inventory";
import { OPEN_STATUSES } from "./orders";

export interface Range {
  fromKey: string; // inclusive local date
  toKey: string; // inclusive local date
  tz: string;
}

export function rangeBounds(r: Range) {
  return { from: zonedMidnight(r.fromKey, r.tz), to: zonedMidnight(addDaysKey(r.toKey, 1), r.tz) };
}

export function rangeDays(r: Range): string[] {
  const out: string[] = [];
  for (let k = r.fromKey; k <= r.toKey; k = addDaysKey(k, 1)) out.push(k);
  return out;
}

/** Parses ?range=today|7d|30d|90d or ?from=&to= into a local-date range. */
export function parseRange(sp: Record<string, string | string[] | undefined>, tz: string, now: Date, defaultRange = "today"): Range & { key: string } {
  const today = localDateKey(now, tz);
  const from = typeof sp.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null;
  const to = typeof sp.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null;
  if (from && to && from <= to) return { fromKey: from, toKey: to, tz, key: "custom" };
  const key = typeof sp.range === "string" ? sp.range : defaultRange;
  const days = key === "7d" ? 7 : key === "30d" ? 30 : key === "90d" ? 90 : key === "yesterday" ? -1 : 1;
  if (days === -1) {
    const y = addDaysKey(today, -1);
    return { fromKey: y, toKey: y, tz, key };
  }
  return { fromKey: addDaysKey(today, -(days - 1)), toKey: today, tz, key: days === 1 ? "today" : key };
}

type DayRow = { day: string; v: number };

async function daily(tx: Tx, sql: Prisma.Sql): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<DayRow[]>(sql);
  return new Map(rows.map((r) => [r.day, Number(r.v)]));
}

/** Operational KPIs for the executive dashboard — all computed from records. */
export async function dashboardKpis(tx: Tx, r: Range, now: Date, settings: { expiryWarningHours: number }) {
  const { from, to } = rangeBounds(r);
  const [inputs, outputs, activeOrders, deliveredOrders, chilled, expiring, alerts, returns, retailSales, b2bSales, receivables, frozen] = await Promise.all([
    tx.shiftInput.aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { inputWeightKg: true, birdsProcessed: true } }),
    tx.productionOutput.groupBy({ by: ["outputType"], where: { producedAt: { gte: from, lt: to } }, _sum: { weightKg: true } }),
    tx.order.count({ where: { status: { in: OPEN_STATUSES } } }),
    tx.order.findMany({ where: { deliveredAt: { gte: from, lt: to }, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] } }, select: { onTime: true, inFull: true } }),
    tx.inventory.aggregate({ where: { quantityKg: { gt: EPS }, product: { storageType: "CHILLED" }, expiryDate: { gt: now } }, _sum: { quantityKg: true } }),
    tx.inventory.aggregate({
      where: { quantityKg: { gt: EPS }, expiryDate: { gt: now, lte: addHours(now, settings.expiryWarningHours) }, status: { not: "BLOCKED" } },
      _sum: { quantityKg: true },
      _count: true,
    }),
    tx.temperatureReading.count({ where: { isExcursion: true, recordedAt: { gte: from, lt: to } } }),
    tx.returnRecord.aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { quantityKg: true }, _count: true }),
    tx.sale.aggregate({ where: { soldAt: { gte: from, lt: to } }, _sum: { total: true } }),
    tx.salesInvoice.aggregate({ where: { issuedAt: { gte: from, lt: to }, status: { not: "VOID" } }, _sum: { amount: true } }),
    tx.salesInvoice.aggregate({ where: { status: { in: ["UNPAID", "PARTIAL"] } }, _sum: { amount: true, paidAmount: true }, _count: true }),
    tx.inventory.aggregate({ where: { quantityKg: { gt: EPS }, product: { storageType: "FROZEN" }, expiryDate: { gt: now } }, _sum: { quantityKg: true } }),
  ]);
  const out = (t: string) => outputs.find((o) => o.outputType === t)?._sum.weightKg ?? 0;
  const inputKg = inputs._sum.inputWeightKg ?? 0;
  const saleable = out("PRODUCT") + out("BYPRODUCT");
  // Yield/waste are computed only over shift×batch inputs whose outputs have been recorded,
  // so an in-progress shift does not depress the ratio.
  const [yb] = await tx.$queryRaw<{ input: number; pending: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM production_outputs o WHERE o."shiftId" = si."shiftId" AND o."batchId" = si."batchId") THEN si."inputWeightKg" ELSE 0 END), 0)::float AS input,
           COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM production_outputs o WHERE o."shiftId" = si."shiftId" AND o."batchId" = si."batchId") THEN si."inputWeightKg" ELSE 0 END), 0)::float AS pending
    FROM shift_inputs si WHERE si."createdAt" >= ${from} AND si."createdAt" < ${to}`;
  const yieldInput = yb?.input ?? 0;
  const otifCount = deliveredOrders.filter((o) => o.onTime && o.inFull).length;
  return {
    productionKg: saleable,
    inputKg,
    birds: inputs._sum.birdsProcessed ?? 0,
    yieldPct: pct(saleable, yieldInput),
    wastePct: pct(out("WASTE"), yieldInput),
    yieldInputKg: yieldInput,
    pendingInputKg: yb?.pending ?? 0,
    wasteKg: out("WASTE"),
    activeOrders,
    deliveredOrders: deliveredOrders.length,
    otifPct: deliveredOrders.length ? pct(otifCount, deliveredOrders.length) : null,
    chilledKg: chilled._sum.quantityKg ?? 0,
    frozenKg: frozen._sum.quantityKg ?? 0,
    expiringKg: expiring._sum.quantityKg ?? 0,
    expiringLots: expiring._count,
    coldChainAlerts: alerts,
    returnsKg: returns._sum.quantityKg ?? 0,
    returnsCount: returns._count,
    salesRetail: num(retailSales._sum.total),
    salesB2b: num(b2bSales._sum.amount),
    sales: num(retailSales._sum.total) + num(b2bSales._sum.amount),
    receivables: num(receivables._sum.amount) - num(receivables._sum.paidAmount),
    receivablesCount: receivables._count,
  };
}

export async function productionByDay(tx: Tx, r: Range) {
  const { from, to } = rangeBounds(r);
  const rows = await tx.$queryRaw<{ day: string; t: string; v: number }[]>`
    SELECT to_char(("producedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, "outputType"::text AS t, SUM("weightKg")::float AS v
    FROM production_outputs WHERE "producedAt" >= ${from} AND "producedAt" < ${to}
    GROUP BY 1, 2 ORDER BY 1`;
  const inputs = await daily(tx, Prisma.sql`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, SUM("inputWeightKg")::float AS v
    FROM shift_inputs WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1`);
  // ratio denominators only include shift×batch inputs whose outputs are recorded
  const matched = await daily(tx, Prisma.sql`
    SELECT to_char((si."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, SUM(si."inputWeightKg")::float AS v
    FROM shift_inputs si WHERE si."createdAt" >= ${from} AND si."createdAt" < ${to}
      AND EXISTS (SELECT 1 FROM production_outputs o WHERE o."shiftId" = si."shiftId" AND o."batchId" = si."batchId") GROUP BY 1`);
  return rangeDays(r).map((day) => {
    const get = (t: string) => rows.find((x) => x.day === day && x.t === t)?.v ?? 0;
    const input = matched.get(day) ?? 0;
    const products = get("PRODUCT");
    const byproducts = get("BYPRODUCT");
    const waste = get("WASTE");
    return {
      day,
      products: round(products, 1),
      byproducts: round(byproducts, 1),
      waste: round(waste, 1),
      input: round(inputs.get(day) ?? 0, 1),
      yieldPct: input ? round(pct(products + byproducts, input), 2) : null,
      wastePct: input ? round(pct(waste, input), 2) : null,
    };
  });
}

export async function productionByProduct(tx: Tx, r: Range, limit = 12) {
  const { from, to } = rangeBounds(r);
  const rows = await tx.productionOutput.groupBy({
    by: ["productId"],
    where: { producedAt: { gte: from, lt: to }, productId: { not: null } },
    _sum: { weightKg: true },
    orderBy: { _sum: { weightKg: "desc" } },
    take: limit,
  });
  const products = await tx.product.findMany({ where: { id: { in: rows.map((x) => x.productId!) } }, select: { id: true, name: true, sku: true } });
  return rows.map((x) => ({ productId: x.productId!, name: products.find((p) => p.id === x.productId)?.name ?? "—", kg: round(x._sum.weightKg ?? 0, 1) }));
}

/** Yield per farm/supplier: saleable output of the farm's batches / their input weight. */
export async function yieldByFarm(tx: Tx, r: Range, limit = 15) {
  const { from, to } = rangeBounds(r);
  const rows = await tx.$queryRaw<{ farmId: string; name: string; code: string; supplier: string; input: number; saleable: number; waste: number; birds: number }[]>`
    WITH inp AS (
      SELECT b."farmId", SUM(si."inputWeightKg") AS input, SUM(si."birdsProcessed") AS birds
      FROM shift_inputs si JOIN production_batches b ON b.id = si."batchId"
      WHERE si."createdAt" >= ${from} AND si."createdAt" < ${to} GROUP BY 1
    ), outp AS (
      SELECT b."farmId",
        SUM(CASE WHEN o."outputType" <> 'WASTE' THEN o."weightKg" ELSE 0 END) AS saleable,
        SUM(CASE WHEN o."outputType" = 'WASTE' THEN o."weightKg" ELSE 0 END) AS waste
      FROM production_outputs o JOIN production_batches b ON b.id = o."batchId"
      WHERE o."producedAt" >= ${from} AND o."producedAt" < ${to} GROUP BY 1
    )
    SELECT f.id AS "farmId", f.name, f.code, s.name AS supplier, inp.input::float, COALESCE(outp.saleable,0)::float AS saleable,
           COALESCE(outp.waste,0)::float AS waste, inp.birds::int AS birds
    FROM inp JOIN farms f ON f.id = inp."farmId" JOIN suppliers s ON s.id = f."supplierId"
    LEFT JOIN outp ON outp."farmId" = inp."farmId"
    WHERE inp.input > 0 ORDER BY inp.input DESC LIMIT ${limit}`;
  return rows.map((x) => ({ ...x, yieldPct: round(pct(x.saleable, x.input), 2), wastePct: round(pct(x.waste, x.input), 2), avgBirdKg: x.birds ? round(x.input / x.birds, 3) : 0 }));
}

export async function yieldByShift(tx: Tx, r: Range, limit = 20) {
  const { from, to } = rangeBounds(r);
  const shifts = await tx.productionShift.findMany({
    where: { shiftDate: { gte: dateOnly(r.fromKey), lte: dateOnly(r.toKey) } },
    include: { line: true, inputs: { select: { inputWeightKg: true, birdsProcessed: true } }, outputs: { select: { outputType: true, weightKg: true } } },
    orderBy: [{ shiftDate: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  void from;
  void to;
  return shifts
    .map((s) => {
      const input = s.inputs.reduce((a, i) => a + i.inputWeightKg, 0);
      const saleable = s.outputs.filter((o) => o.outputType !== "WASTE").reduce((a, o) => a + o.weightKg, 0);
      const waste = s.outputs.filter((o) => o.outputType === "WASTE").reduce((a, o) => a + o.weightKg, 0);
      return {
        id: s.id,
        label: `${s.number.replace(/^SH-\d{4}-/, "#")} ${s.shiftType}`,
        number: s.number,
        line: s.line.name,
        date: s.shiftDate,
        shiftType: s.shiftType,
        status: s.status,
        input: round(input, 1),
        saleable: round(saleable, 1),
        waste: round(waste, 1),
        yieldPct: round(pct(saleable, input), 2),
        wastePct: round(pct(waste, input), 2),
        unexplainedPct: round(pct(input - saleable - waste, input), 2),
        plannedInputKg: s.plannedInputKg,
      };
    })
    .reverse();
}

export async function salesByDay(tx: Tx, r: Range) {
  const { from, to } = rangeBounds(r);
  const retail = await daily(tx, Prisma.sql`
    SELECT to_char(("soldAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, SUM(total)::float AS v
    FROM sales WHERE "soldAt" >= ${from} AND "soldAt" < ${to} GROUP BY 1`);
  const b2b = await daily(tx, Prisma.sql`
    SELECT to_char(("issuedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, SUM(amount)::float AS v
    FROM sales_invoices WHERE "issuedAt" >= ${from} AND "issuedAt" < ${to} AND status <> 'VOID' GROUP BY 1`);
  return rangeDays(r).map((day) => ({ day, retail: round(retail.get(day) ?? 0, 0), b2b: round(b2b.get(day) ?? 0, 0) }));
}

/** Ordered (requested delivery date) + retail sold kg per day vs. produced saleable kg per day. */
export async function demandVsProduction(tx: Tx, r: Range) {
  const { from, to } = rangeBounds(r);
  const ordered = await daily(tx, Prisma.sql`
    SELECT to_char(o."requestedDeliveryDate", 'YYYY-MM-DD') AS day, SUM(i."quantityKg")::float AS v
    FROM order_items i JOIN orders o ON o.id = i."orderId"
    WHERE o."requestedDeliveryDate" >= ${dateOnly(r.fromKey)} AND o."requestedDeliveryDate" <= ${dateOnly(r.toKey)} AND o.status <> 'CANCELLED'
    GROUP BY 1`);
  const retail = await daily(tx, Prisma.sql`
    SELECT to_char(("soldAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, SUM("quantityKg")::float AS v
    FROM sales WHERE "soldAt" >= ${from} AND "soldAt" < ${to} GROUP BY 1`);
  const produced = await daily(tx, Prisma.sql`
    SELECT to_char(("producedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, SUM("weightKg")::float AS v
    FROM production_outputs WHERE "producedAt" >= ${from} AND "producedAt" < ${to} AND "outputType" <> 'WASTE' GROUP BY 1`);
  const planned = await daily(tx, Prisma.sql`
    SELECT to_char("planDate", 'YYYY-MM-DD') AS day, SUM("adjustedKg")::float AS v
    FROM production_plans WHERE "planDate" >= ${dateOnly(r.fromKey)} AND "planDate" <= ${dateOnly(r.toKey)} GROUP BY 1`);
  return rangeDays(r).map((day) => ({
    day,
    demand: round((ordered.get(day) ?? 0) + (retail.get(day) ?? 0), 1),
    produced: round(produced.get(day) ?? 0, 1),
    planned: planned.has(day) ? round(planned.get(day)!, 1) : null,
  }));
}

export async function inventoryByWarehouse(tx: Tx, now: Date) {
  const rows = await tx.$queryRaw<{ id: string; name: string; type: string; chilled: number; frozen: number; other: number; blocked: number; value: number }[]>`
    SELECT w.id, w.name, w.type,
      SUM(CASE WHEN p."storageType" = 'CHILLED' AND i.status <> 'BLOCKED' THEN i."quantityKg" ELSE 0 END)::float AS chilled,
      SUM(CASE WHEN p."storageType" = 'FROZEN' AND i.status <> 'BLOCKED' THEN i."quantityKg" ELSE 0 END)::float AS frozen,
      SUM(CASE WHEN p."storageType" = 'AMBIENT' AND i.status <> 'BLOCKED' THEN i."quantityKg" ELSE 0 END)::float AS other,
      SUM(CASE WHEN i.status = 'BLOCKED' THEN i."quantityKg" ELSE 0 END)::float AS blocked,
      SUM(i."quantityKg" * COALESCE(i."unitCost", p."costPerKg", 0))::float AS value
    FROM inventory i JOIN warehouses w ON w.id = i."warehouseId" JOIN products p ON p.id = i."productId"
    WHERE i."quantityKg" > 0.0005 AND i."expiryDate" > ${now}
    GROUP BY w.id, w.name, w.type ORDER BY (w.type = 'RETAIL'), w.name`;
  return rows.map((x) => ({ ...x, chilled: round(x.chilled, 1), frozen: round(x.frozen, 1), blocked: round(x.blocked, 1), value: round(x.value, 0) }));
}

/** Kg by remaining shelf-life bucket. */
export async function expiryRisk(tx: Tx, now: Date) {
  const lots = await tx.inventory.findMany({ where: { quantityKg: { gt: EPS } }, select: { quantityKg: true, expiryDate: true, status: true } });
  const buckets = [
    { key: "expired", label: "Expired", kg: 0 },
    { key: "24", label: "≤ 24 h", kg: 0 },
    { key: "48", label: "24–48 h", kg: 0 },
    { key: "72", label: "48–72 h", kg: 0 },
    { key: "7d", label: "3–7 days", kg: 0 },
    { key: "more", label: "> 7 days", kg: 0 },
  ];
  for (const l of lots) {
    const h = (l.expiryDate.getTime() - now.getTime()) / 3600000;
    const b = h <= 0 ? 0 : h <= 24 ? 1 : h <= 48 ? 2 : h <= 72 ? 3 : h <= 168 ? 4 : 5;
    buckets[b].kg += l.quantityKg;
  }
  return buckets.map((b) => ({ ...b, kg: round(b.kg, 1) }));
}

export async function deliveryPerformance(tx: Tx, r: Range) {
  const { from, to } = rangeBounds(r);
  const rows = await tx.$queryRaw<{ day: string; total: number; ontime: number; infull: number; otif: number }[]>`
    SELECT to_char(("deliveredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS total,
      SUM(CASE WHEN "onTime" THEN 1 ELSE 0 END)::int AS ontime, SUM(CASE WHEN "inFull" THEN 1 ELSE 0 END)::int AS infull,
      SUM(CASE WHEN "onTime" AND "inFull" THEN 1 ELSE 0 END)::int AS otif
    FROM orders WHERE "deliveredAt" >= ${from} AND "deliveredAt" < ${to} GROUP BY 1 ORDER BY 1`;
  return rangeDays(r).map((day) => {
    const x = rows.find((y) => y.day === day);
    return {
      day,
      delivered: x?.total ?? 0,
      otifPct: x?.total ? round(pct(x.otif, x.total), 1) : null,
      onTimePct: x?.total ? round(pct(x.ontime, x.total), 1) : null,
      inFullPct: x?.total ? round(pct(x.infull, x.total), 1) : null,
    };
  });
}

export async function temperatureExcursions(tx: Tx, r: Range) {
  const { from, to } = rangeBounds(r);
  const rows = await tx.$queryRaw<{ day: string; src: string; v: number }[]>`
    SELECT to_char(("recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}, 'YYYY-MM-DD') AS day, "sourceType"::text AS src, COUNT(*)::int AS v
    FROM temperature_readings WHERE "recordedAt" >= ${from} AND "recordedAt" < ${to} AND "isExcursion" = true GROUP BY 1, 2`;
  return rangeDays(r).map((day) => ({
    day,
    chamber: rows.find((x) => x.day === day && x.src === "CHAMBER")?.v ?? 0,
    vehicle: rows.find((x) => x.day === day && x.src === "VEHICLE")?.v ?? 0,
  }));
}

/** Supplier comparison: deliveries, acceptance, average bird weight and downstream yield. */
export async function supplierPerformance(tx: Tx, r: Range) {
  const { from, to } = rangeBounds(r);
  return tx.$queryRaw<
    { id: string; code: string; name: string; deliveries: number; birds: number; accepted: number; netKg: number; acceptedKg: number; doa: number; rejectedDeliveries: number; avgBird: number; input: number; saleable: number }[]
  >`
    WITH rc AS (
      SELECT "supplierId", COUNT(*)::int AS deliveries, SUM("birdsReceived")::int AS birds, SUM("birdsAccepted")::int AS accepted,
        SUM("netWeightKg")::float AS "netKg", SUM("acceptedWeightKg")::float AS "acceptedKg", SUM("birdsDeadOnArrival")::int AS doa,
        SUM(CASE WHEN status <> 'ACCEPTED' THEN 1 ELSE 0 END)::int AS "rejectedDeliveries",
        (SUM("netWeightKg") / NULLIF(SUM("birdsReceived"),0))::float AS "avgBird"
      FROM raw_material_receipts WHERE "receivedAt" >= ${from} AND "receivedAt" < ${to} GROUP BY 1
    ), y AS (
      SELECT b."supplierId", SUM(si."inputWeightKg")::float AS input
      FROM shift_inputs si JOIN production_batches b ON b.id = si."batchId" WHERE b."createdAt" >= ${from} AND b."createdAt" < ${to} GROUP BY 1
    ), o AS (
      SELECT b."supplierId", SUM(CASE WHEN po."outputType" <> 'WASTE' THEN po."weightKg" ELSE 0 END)::float AS saleable
      FROM production_outputs po JOIN production_batches b ON b.id = po."batchId" WHERE b."createdAt" >= ${from} AND b."createdAt" < ${to} GROUP BY 1
    )
    SELECT s.id, s.code, s.name, rc.deliveries, rc.birds, rc.accepted, rc."netKg", rc."acceptedKg", rc.doa, rc."rejectedDeliveries", rc."avgBird",
      COALESCE(y.input, 0) AS input, COALESCE(o.saleable, 0) AS saleable
    FROM rc JOIN suppliers s ON s.id = rc."supplierId" LEFT JOIN y ON y."supplierId" = s.id LEFT JOIN o ON o."supplierId" = s.id
    ORDER BY rc."acceptedKg" DESC`;
}

export async function retailSalesSummary(tx: Tx, r: Range) {
  const { from, to } = rangeBounds(r);
  const [byLoc, byProduct] = await Promise.all([
    tx.sale.groupBy({ by: ["retailLocationId"], where: { soldAt: { gte: from, lt: to } }, _sum: { total: true, quantityKg: true } }),
    tx.sale.groupBy({ by: ["productId"], where: { soldAt: { gte: from, lt: to } }, _sum: { total: true, quantityKg: true }, orderBy: { _sum: { total: "desc" } }, take: 10 }),
  ]);
  const [locs, prods] = await Promise.all([
    tx.retailLocation.findMany({ select: { id: true, name: true, code: true } }),
    tx.product.findMany({ where: { id: { in: byProduct.map((b) => b.productId) } }, select: { id: true, name: true } }),
  ]);
  return {
    byLocation: locs
      .map((l) => {
        const x = byLoc.find((b) => b.retailLocationId === l.id);
        return { id: l.id, name: l.name, code: l.code, total: num(x?._sum.total), kg: round(x?._sum.quantityKg ?? 0, 1) };
      })
      .sort((a, b) => b.total - a.total),
    byProduct: byProduct.map((b) => ({ productId: b.productId, name: prods.find((p) => p.id === b.productId)?.name ?? "—", total: num(b._sum.total), kg: round(b._sum.quantityKg ?? 0, 1) })),
  };
}
