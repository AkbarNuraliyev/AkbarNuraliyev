import type { Tx } from "@/lib/prisma";
import { fmtDate, fmtDateTime, fmtDay, num, round } from "@/lib/format";
import { dateOnly } from "@/lib/tz";
import type { ServiceCtx } from "./core";
import { dashboardKpis, parseRange, productionByDay, rangeBounds, supplierPerformance, yieldByFarm, yieldByShift, salesByDay } from "./services/analytics";

type Row = Record<string, string | number | null>;
type SPx = Record<string, string | string[] | undefined>;

export interface ExportDef {
  title: string;
  permission: string;
  feature?: string;
  build: (tx: Tx, ctx: ServiceCtx, sp: SPx) => Promise<Row[]>;
}

const s = (sp: SPx, k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);

function bounds(ctx: ServiceCtx, sp: SPx, def = "30d") {
  const r = parseRange(sp, ctx.tz, new Date(), def);
  return { r, ...rangeBounds(r) };
}

export const EXPORTS: Record<string, ExportDef> = {
  dashboard: {
    title: "Operational overview",
    permission: "overview.view",
    async build(tx, ctx, sp) {
      const { r } = bounds(ctx, sp, "today");
      const k = await dashboardKpis(tx, r, new Date(), ctx.settings);
      const rows: Row[] = Object.entries(k).map(([key, v]) => ({ section: "KPI", metric: key, value: typeof v === "number" ? round(v, 3) : v, from: r.fromKey, to: r.toKey }));
      const days = await productionByDay(tx, r);
      for (const d of days) rows.push({ section: "Production by day", metric: d.day, value: null, products_kg: d.products, byproducts_kg: d.byproducts, waste_kg: d.waste, input_kg: d.input, yield_pct: d.yieldPct, waste_pct: d.wastePct } as Row);
      return rows;
    },
  },
  suppliers: {
    title: "Suppliers",
    permission: "procurement.view",
    async build(tx) {
      const rows = await tx.supplier.findMany({ include: { _count: { select: { farms: true, receipts: true } } }, orderBy: { code: "asc" } });
      return rows.map((x) => ({ code: x.code, name: x.name, type: x.type, region: x.region, tax_id: x.taxId, contact: x.contactName, phone: x.phone, email: x.email, contract: x.contractNumber, contract_end: x.contractEnd ? fmtDay(x.contractEnd) : null, payment_terms_days: x.paymentTermsDays, price_per_kg_live: num(x.pricePerKgLive), farms: x._count.farms, deliveries: x._count.receipts, active: x.isActive ? "yes" : "no" }));
    },
  },
  "supplier-performance": {
    title: "Supplier performance",
    permission: "procurement.view",
    async build(tx, ctx, sp) {
      const { r } = bounds(ctx, sp, "30d");
      const rows = await supplierPerformance(tx, r);
      return rows.map((x) => ({ code: x.code, supplier: x.name, deliveries: x.deliveries, birds_received: x.birds, birds_accepted: x.accepted, doa: x.doa, net_live_kg: round(x.netKg, 1), accepted_kg: round(x.acceptedKg, 1), avg_bird_kg: round(x.avgBird, 3), deliveries_with_rejection: x.rejectedDeliveries, processed_input_kg: round(x.input, 1), saleable_output_kg: round(x.saleable, 1), yield_pct: x.input ? round((x.saleable / x.input) * 100, 2) : null }));
    },
  },
  farms: {
    title: "Farms",
    permission: "procurement.view",
    async build(tx) {
      const rows = await tx.farm.findMany({ include: { supplier: true }, orderBy: { code: "asc" } });
      return rows.map((x) => ({ code: x.code, name: x.name, supplier: x.supplier.name, region: x.region, district: x.district, capacity_birds: x.capacityBirds, breed: x.breed, vet_registration: x.vetRegistration, active: x.isActive ? "yes" : "no" }));
    },
  },
  receipts: {
    title: "Raw material receipts",
    permission: "receiving.view",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "30d");
      const rows = await tx.rawMaterialReceipt.findMany({ where: { receivedAt: { gte: from, lt: to } }, include: { supplier: true, farm: true, batch: true }, orderBy: { receivedAt: "desc" } });
      return rows.map((x) => ({ number: x.number, batch: x.batch?.code ?? null, received_at: fmtDateTime(x.receivedAt, ctx.tz), supplier: x.supplier.name, farm: x.farm.code, status: x.status, birds_received: x.birdsReceived, doa: x.birdsDeadOnArrival, birds_rejected: x.birdsRejected, birds_accepted: x.birdsAccepted, gross_kg: x.grossWeightKg, tare_kg: x.tareWeightKg, net_kg: x.netWeightKg, accepted_kg: x.acceptedWeightKg, avg_bird_kg: x.avgBirdWeightKg, grade: x.qualityGrade, rejection_reason: x.rejectionReason, weighing: x.weighingSource }));
    },
  },
  shifts: {
    title: "Production shifts",
    permission: "production.view",
    feature: "production",
    async build(tx, ctx, sp) {
      const { r } = bounds(ctx, sp, "30d");
      const rows = await yieldByShift(tx, r, 1000);
      return rows.map((x) => ({ number: x.number, date: fmtDay(x.date), shift: x.shiftType, line: x.line, status: x.status, planned_input_kg: x.plannedInputKg, input_kg: x.input, saleable_kg: x.saleable, waste_kg: x.waste, yield_pct: x.yieldPct, waste_pct: x.wastePct, unexplained_pct: x.unexplainedPct }));
    },
  },
  outputs: {
    title: "Production outputs",
    permission: "production.view",
    feature: "production",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "7d");
      const rows = await tx.productionOutput.findMany({ where: { producedAt: { gte: from, lt: to } }, include: { product: true, batch: true, shift: true }, orderBy: { producedAt: "desc" }, take: 20000 });
      return rows.map((x) => ({ produced_at: fmtDateTime(x.producedAt, ctx.tz), shift: x.shift.number, batch: x.batch.code, type: x.outputType, sku: x.product?.sku ?? null, product: x.product?.name ?? x.wasteCategory, weight_kg: x.weightKg, units: x.units }));
    },
  },
  "yield-by-farm": {
    title: "Yield by farm",
    permission: "production.view",
    feature: "production",
    async build(tx, ctx, sp) {
      const { r } = bounds(ctx, sp, "30d");
      const rows = await yieldByFarm(tx, r, 1000);
      return rows.map((x) => ({ farm: x.code, name: x.name, supplier: x.supplier, birds: x.birds, input_kg: round(x.input, 1), saleable_kg: round(x.saleable, 1), waste_kg: round(x.waste, 1), yield_pct: x.yieldPct, waste_pct: x.wastePct, avg_bird_kg: x.avgBirdKg }));
    },
  },
  products: {
    title: "Products",
    permission: "products.view",
    async build(tx) {
      const rows = await tx.product.findMany({ include: { category: true }, orderBy: { sku: "asc" } });
      return rows.map((x) => ({ sku: x.sku, name: x.name, category: x.category.name, storage: x.storageType, shelf_life_h: x.shelfLifeHours, variable_weight: x.isVariableWeight ? "yes" : "no", net_weight_kg: x.netWeightKg, price: num(x.price), cost_per_kg: num(x.costPerKg), plu: x.pluCode, barcode: x.barcode, min_stock_kg: x.minStockKg, target_yield_pct: x.targetYieldPct, active: x.isActive ? "yes" : "no" }));
    },
  },
  inventory: {
    title: "Inventory by batch",
    permission: "inventory.view",
    async build(tx, ctx) {
      const rows = await tx.inventory.findMany({ where: { quantityKg: { gt: 0.0005 } }, include: { product: true, batch: true, warehouse: true, chamber: true }, orderBy: [{ expiryDate: "asc" }] });
      const now = Date.now();
      return rows.map((x) => ({ sku: x.product.sku, product: x.product.name, batch: x.batch.code, warehouse: x.warehouse.name, chamber: x.chamber?.name ?? null, status: x.status, quantity_kg: round(x.quantityKg, 3), reserved_kg: round(x.reservedKg, 3), free_kg: round(x.quantityKg - x.reservedKg, 3), production: fmtDateTime(x.productionDate, ctx.tz), expiry: fmtDateTime(x.expiryDate, ctx.tz), hours_left: round((x.expiryDate.getTime() - now) / 3600000, 1), unit_cost: num(x.unitCost), value: round(x.quantityKg * num(x.unitCost ?? x.product.costPerKg), 0) }));
    },
  },
  movements: {
    title: "Inventory movements",
    permission: "inventory.view",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "7d");
      const rows = await tx.inventoryMovement.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { batch: true }, orderBy: { createdAt: "desc" }, take: 50000 });
      const [products, whs] = await Promise.all([tx.product.findMany({ select: { id: true, sku: true, name: true } }), tx.warehouse.findMany({ select: { id: true, name: true } })]);
      return rows.map((x) => ({ at: fmtDateTime(x.createdAt, ctx.tz), type: x.type, sku: products.find((p) => p.id === x.productId)?.sku ?? null, product: products.find((p) => p.id === x.productId)?.name ?? null, batch: x.batch.code, warehouse: whs.find((w) => w.id === x.warehouseId)?.name ?? null, quantity_kg: x.quantityKg, reason: x.reason, reference: x.referenceType }));
    },
  },
  orders: {
    title: "Orders",
    permission: "orders.view",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "30d");
      const rows = await tx.order.findMany({ where: { orderDate: { gte: from, lt: to } }, include: { customer: true, items: true }, orderBy: { orderDate: "desc" } });
      return rows.map((x) => ({ number: x.number, customer: x.customer.name, type: x.customer.type, source: x.source, status: x.status, order_date: fmtDateTime(x.orderDate, ctx.tz), delivery_date: fmtDay(x.requestedDeliveryDate), ordered_kg: round(x.items.reduce((a, i) => a + i.quantityKg, 0), 3), delivered_kg: round(x.items.reduce((a, i) => a + i.deliveredKg, 0), 3), total: num(x.total), on_time: x.onTime === null ? null : x.onTime ? "yes" : "no", in_full: x.inFull === null ? null : x.inFull ? "yes" : "no", external_ref: x.externalRef }));
    },
  },
  customers: {
    title: "Customers",
    permission: "sales.view",
    async build(tx) {
      const rows = await tx.customer.findMany({ include: { priceList: true }, orderBy: { code: "asc" } });
      return rows.map((x) => ({ code: x.code, name: x.name, type: x.type, tax_id: x.taxId, contact: x.contactName, phone: x.phone, email: x.email, region: x.region, price_list: x.priceList?.name ?? null, payment_terms_days: x.paymentTermsDays, credit_limit: num(x.creditLimit), active: x.isActive ? "yes" : "no" }));
    },
  },
  receivables: {
    title: "Sales invoices / receivables",
    permission: "sales.view",
    async build(tx, ctx) {
      const rows = await tx.salesInvoice.findMany({ include: { customer: true, order: true }, orderBy: { issuedAt: "desc" } });
      return rows.map((x) => ({ number: x.number, order: x.order.number, customer: x.customer.name, issued: fmtDate(x.issuedAt, ctx.tz), due: fmtDate(x.dueAt, ctx.tz), amount: num(x.amount), paid: num(x.paidAmount), outstanding: round(num(x.amount) - num(x.paidAmount), 2), status: x.status }));
    },
  },
  shipments: {
    title: "Shipments",
    permission: "logistics.view",
    feature: "logistics",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "30d");
      const rows = await tx.shipment.findMany({ where: { plannedDeparture: { gte: from, lt: to } }, include: { vehicle: true, driver: true, route: true, stops: true }, orderBy: { plannedDeparture: "desc" } });
      return rows.map((x) => ({ number: x.number, status: x.status, vehicle: x.vehicle.plate, driver: x.driver.name, route: x.route?.name ?? null, mode: x.temperatureMode, planned: fmtDateTime(x.plannedDeparture, ctx.tz), departed: fmtDateTime(x.departedAt, ctx.tz), arrived: fmtDateTime(x.arrivedAt, ctx.tz), stops: x.stops.length }));
    },
  },
  temperature: {
    title: "Temperature readings",
    permission: "logistics.view",
    feature: "logistics",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "7d");
      const rows = await tx.temperatureReading.findMany({ where: { recordedAt: { gte: from, lt: to } }, include: { chamber: true, vehicle: true, shipment: true }, orderBy: { recordedAt: "desc" }, take: 50000 });
      return rows.map((x) => ({ at: fmtDateTime(x.recordedAt, ctx.tz), source: x.sourceType, chamber: x.chamber?.name ?? null, vehicle: x.vehicle?.plate ?? null, shipment: x.shipment?.number ?? null, temperature_c: x.temperatureC, min_c: x.limitMinC, max_c: x.limitMaxC, excursion: x.isExcursion ? "yes" : "no", data_source: x.dataSource, device: x.deviceId }));
    },
  },
  sales: {
    title: "Retail sales",
    permission: "retail.view",
    feature: "retail",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "7d");
      const loc = s(sp, "location");
      const rows = await tx.sale.findMany({ where: { soldAt: { gte: from, lt: to }, ...(loc ? { retailLocationId: loc } : {}) }, include: { location: true, product: true }, orderBy: { soldAt: "desc" }, take: 50000 });
      return rows.map((x) => ({ at: fmtDateTime(x.soldAt, ctx.tz), store: x.location.name, type: x.type, receipt: x.receiptNo, sku: x.product.sku, product: x.product.name, quantity_kg: x.quantityKg, unit_price: num(x.unitPrice), total: num(x.total), cashier: x.cashierName, source: x.source }));
    },
  },
  "sales-daily": {
    title: "Sales by day",
    permission: "reports.view",
    feature: "reports",
    async build(tx, ctx, sp) {
      const { r } = bounds(ctx, sp, "30d");
      return (await salesByDay(tx, r)).map((d) => ({ day: d.day, b2b_invoiced: d.b2b, retail: d.retail, total: d.b2b + d.retail }));
    },
  },
  quality: {
    title: "Quality records",
    permission: "quality.view",
    feature: "quality",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "30d");
      const rows = await tx.qualityRecord.findMany({ where: { performedAt: { gte: from, lt: to } }, include: { checklist: true }, orderBy: { performedAt: "desc" } });
      return rows.map((x) => ({ number: x.number, at: fmtDateTime(x.performedAt, ctx.tz), checklist: x.checklist.name, type: x.checklist.type, area: x.area, result: x.result, performed_by: x.performedByName, notes: x.notes }));
    },
  },
  nonconformities: {
    title: "Non-conformities",
    permission: "quality.view",
    feature: "quality",
    async build(tx, ctx) {
      const rows = await tx.nonconformity.findMany({ include: { batch: true, actions: true }, orderBy: { createdAt: "desc" } });
      return rows.map((x) => ({ number: x.number, created: fmtDateTime(x.createdAt, ctx.tz), title: x.title, severity: x.severity, source: x.source, status: x.status, batch: x.batch?.code ?? null, responsible: x.responsibleName, due: x.dueDate ? fmtDate(x.dueDate, ctx.tz) : null, root_cause: x.rootCause, actions: x.actions.length, closed: x.closedAt ? fmtDateTime(x.closedAt, ctx.tz) : null }));
    },
  },
  audit: {
    title: "Audit log",
    permission: "settings.manage",
    async build(tx, ctx, sp) {
      const { from, to } = bounds(ctx, sp, "30d");
      const rows = await tx.auditLog.findMany({ where: { createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "desc" }, take: 50000 });
      return rows.map((x) => ({ at: fmtDateTime(x.createdAt, ctx.tz), user: x.userEmail, action: x.action, entity: x.entityType, entity_id: x.entityId, summary: x.summary }));
    },
  },
  plans: {
    title: "Production plans",
    permission: "production.view",
    feature: "forecasting",
    async build(tx, ctx, sp) {
      const { r } = bounds(ctx, sp, "30d");
      const rows = await tx.productionPlan.findMany({ where: { planDate: { gte: dateOnly(r.fromKey), lte: dateOnly(r.toKey) } }, include: { product: true }, orderBy: [{ planDate: "desc" }, { product: { sku: "asc" } }] });
      return rows.map((x) => ({ date: fmtDay(x.planDate), sku: x.product.sku, product: x.product.name, forecast_kg: x.forecastKg, confirmed_orders_kg: x.confirmedOrdersKg, usable_stock_kg: x.availableStockKg, recommended_kg: x.recommendedKg, planned_kg: x.adjustedKg, status: x.status }));
    },
  },
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const str = String(v);
  return /[",;\n\r]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
}

export function toCsv(rows: Row[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return "﻿" + lines.join("\r\n");
}

export async function toXlsx(title: string, rows: Row[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PoultryOS";
  const ws = wb.addWorksheet(title.slice(0, 30));
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(10, c.length + 4)) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
