import type { Tx } from "@/lib/prisma";
import type { OrderSource, OrderStatus } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { num, round } from "@/lib/format";
import { addDays, addDaysKey, dateOnly, dateOnlyKey, localDateKey, zonedMidnight } from "@/lib/tz";
import { audit, nextNumber, nowOf, traceEvent, type ServiceCtx } from "../core";
import { EPS, fefoCandidates, planFefo, removeStock } from "./inventory";
import { emitWebhook } from "./webhooks";

export const ORDER_FLOW: OrderStatus[] = ["NEW", "CONFIRMED", "ALLOCATED", "PICKING", "READY_FOR_DISPATCH", "IN_DELIVERY", "DELIVERED"];
export const OPEN_STATUSES: OrderStatus[] = ["NEW", "CONFIRMED", "ALLOCATED", "PICKING", "READY_FOR_DISPATCH", "IN_DELIVERY"];
export const CANCELLABLE: OrderStatus[] = ["NEW", "CONFIRMED", "ALLOCATED", "PICKING", "READY_FOR_DISPATCH"];

async function setStatus(tx: Tx, ctx: ServiceCtx, orderId: string, from: OrderStatus, to: OrderStatus, note?: string, extra: Record<string, unknown> = {}) {
  await tx.order.update({ where: { id: orderId }, data: { status: to, ...extra } });
  await tx.orderStatusHistory.create({
    data: { tenantId: ctx.tenantId, orderId, fromStatus: from, toStatus: to, note: note ?? null, userId: ctx.userId ?? null, createdAt: nowOf(ctx) },
  });
  await audit(tx, ctx, { action: "order.status", entityType: "order", entityId: orderId, summary: `${from} → ${to}${note ? ": " + note : ""}`, changes: { status: { from, to } } });
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { number: true, customerId: true } });
  await emitWebhook(tx, ctx, "order.status_changed", { order: o.number, from, to });
}

/** Contract price for a customer: price-list item if present, else product base price. */
export async function priceFor(tx: Tx, customerId: string, productId: string): Promise<number> {
  const c = await tx.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
  if (c?.priceListId) {
    const item = await tx.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: c.priceListId, productId } } });
    if (item) return num(item.price);
  }
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { price: true } });
  return num(p.price);
}

export interface CreateOrderInput {
  customerId: string;
  requestedDeliveryDate: string; // YYYY-MM-DD (tenant local)
  deliveryAddress?: string | null;
  notes?: string | null;
  externalRef?: string | null;
  source: OrderSource;
  items: { productId: string; quantityKg: number; unitPrice?: number | null }[];
  /** Portal orders may only contain products of the customer's assigned price list. */
  restrictToPriceList?: boolean;
}

export async function createOrder(tx: Tx, ctx: ServiceCtx, input: CreateOrderInput) {
  const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
  assert(customer && customer.isActive, "Customer not found or inactive", {}, "customerId");
  assert(input.items.length > 0, "Add at least one product to the order", {}, "items");
  const today = localDateKey(nowOf(ctx), ctx.tz);
  if (input.requestedDeliveryDate < today) throw new AppError("Delivery date cannot be in the past", {}, "requestedDeliveryDate");
  if (input.source === "PORTAL" && input.requestedDeliveryDate <= today)
    throw new AppError("Portal orders must be placed at least one day before delivery", {}, "requestedDeliveryDate");

  const seen = new Set<string>();
  const lines: { productId: string; quantityKg: number; unitPrice: number; lineTotal: number }[] = [];
  for (const it of input.items) {
    assert(it.quantityKg > 0, "Quantities must be greater than zero", {}, "items");
    assert(it.quantityKg <= 50000, "Quantity per line is too large", {}, "items");
    if (seen.has(it.productId)) throw new AppError("Each product may appear only once per order", {}, "items");
    seen.add(it.productId);
    const product = await tx.product.findUnique({ where: { id: it.productId } });
    assert(product && product.isActive, "Product not found or inactive", {}, "items");
    if (input.restrictToPriceList) {
      assert(customer.priceListId, "No catalog is assigned to your account yet", {}, "items");
      const pli = await tx.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: customer.priceListId, productId: product.id } } });
      assert(pli, "{product} is not in your assigned catalog", { product: product.name }, "items");
    }
    const unitPrice = it.unitPrice ?? (await priceFor(tx, customer.id, product.id));
    lines.push({ productId: product.id, quantityKg: round(it.quantityKg, 3), unitPrice, lineTotal: round(unitPrice * it.quantityKg, 2) });
  }
  const subtotal = round(lines.reduce((s, l) => s + l.lineTotal, 0), 2);
  const number = await nextNumber(tx, ctx, "SO");
  const order = await tx.order.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      customerId: customer.id,
      source: input.source,
      externalRef: input.externalRef ?? null,
      orderDate: nowOf(ctx),
      requestedDeliveryDate: dateOnly(input.requestedDeliveryDate),
      deliveryAddress: input.deliveryAddress ?? customer.deliveryAddress ?? customer.address,
      notes: input.notes ?? null,
      subtotal,
      total: subtotal,
      createdById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
      items: { create: lines.map((l) => ({ tenantId: ctx.tenantId, ...l })) },
    },
  });
  await tx.orderStatusHistory.create({
    data: { tenantId: ctx.tenantId, orderId: order.id, toStatus: "NEW", note: `Created (${input.source.toLowerCase()})`, userId: ctx.userId ?? null, createdAt: nowOf(ctx) },
  });
  await audit(tx, ctx, { action: "order.create", entityType: "order", entityId: order.id, summary: `${number} for ${customer.name}: ${subtotal} ${"UZS"}` });
  await emitWebhook(tx, ctx, "order.created", { order: number, customer: customer.code, total: subtotal, deliveryDate: input.requestedDeliveryDate });
  return order;
}

async function loadOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { allocations: true, product: true } }, customer: true } });
  assert(order, "Order not found");
  return order;
}

export async function confirmOrder(tx: Tx, ctx: ServiceCtx, orderId: string) {
  const order = await loadOrder(tx, orderId);
  if (order.status !== "NEW") throw new AppError("Only new orders can be confirmed");
  await setStatus(tx, ctx, order.id, "NEW", "CONFIRMED", undefined, { confirmedAt: nowOf(ctx) });
}

/**
 * FEFO allocation: reserves the earliest-expiring lots that remain valid
 * through the requested delivery day. Can be re-run to allocate shortages
 * after new production.
 */
export async function allocateOrder(tx: Tx, ctx: ServiceCtx, orderId: string) {
  const order = await loadOrder(tx, orderId);
  if (!["CONFIRMED", "ALLOCATED"].includes(order.status)) throw new AppError("Confirm the order before allocating stock");
  const deliveryKey = dateOnlyKey(order.requestedDeliveryDate);
  const validUntil = zonedMidnight(addDaysKey(deliveryKey, 1), ctx.tz); // must not expire before end of delivery day
  let totalShort = 0;
  const result: { productId: string; allocatedKg: number; shortageKg: number }[] = [];
  for (const item of order.items) {
    const reserved = item.allocations.filter((a) => a.status === "RESERVED" || a.status === "PICKED").reduce((s, a) => s + a.quantityKg, 0);
    const need = round(item.quantityKg - reserved, 3);
    if (need <= EPS) {
      result.push({ productId: item.productId, allocatedKg: 0, shortageKg: 0 });
      continue;
    }
    const candidates = await fefoCandidates(tx, { productId: item.productId, mustBeValidUntil: validUntil, excludeRetail: true });
    const { picks, shortageKg } = planFefo(candidates, need);
    for (const p of picks) {
      await tx.orderAllocation.create({
        data: { tenantId: ctx.tenantId, orderItemId: item.id, inventoryId: p.inventoryId, batchId: p.batchId, quantityKg: p.quantityKg, createdAt: nowOf(ctx) },
      });
      await tx.inventory.update({ where: { id: p.inventoryId }, data: { reservedKg: { increment: p.quantityKg } } });
      await traceEvent(tx, ctx, {
        batchId: p.batchId,
        eventType: "ALLOCATED",
        description: `${item.product.name}: ${p.quantityKg} kg reserved (FEFO) for order ${order.number} — ${order.customer.name}`,
        quantityKg: p.quantityKg,
        entityType: "order",
        entityId: order.id,
      });
    }
    const allocated = round(picks.reduce((s, p) => s + p.quantityKg, 0), 3);
    await tx.orderItem.update({ where: { id: item.id }, data: { allocatedKg: round(reserved + allocated, 3) } });
    totalShort += shortageKg;
    result.push({ productId: item.productId, allocatedKg: allocated, shortageKg });
  }
  if (order.status === "CONFIRMED") {
    await setStatus(tx, ctx, order.id, "CONFIRMED", "ALLOCATED", totalShort > EPS ? `Shortage ${round(totalShort, 1)} kg — waiting for production` : "Fully allocated (FEFO)");
  } else {
    await audit(tx, ctx, { action: "order.reallocate", entityType: "order", entityId: order.id, summary: `Re-allocation, remaining shortage ${round(totalShort, 1)} kg` });
  }
  return { lines: result, shortageKg: round(totalShort, 3) };
}

async function releaseAllocations(tx: Tx, ctx: ServiceCtx, order: Awaited<ReturnType<typeof loadOrder>>) {
  for (const item of order.items) {
    for (const a of item.allocations) {
      if (a.status !== "RESERVED" && a.status !== "PICKED") continue;
      const lot = await tx.inventory.findUnique({ where: { id: a.inventoryId } });
      if (lot) await tx.inventory.update({ where: { id: lot.id }, data: { reservedKg: Math.max(0, round(lot.reservedKg - a.quantityKg, 3)) } });
      await tx.orderAllocation.update({ where: { id: a.id }, data: { status: "RELEASED" } });
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { allocatedKg: 0, pickedKg: 0 } });
  }
}

export async function startPicking(tx: Tx, ctx: ServiceCtx, orderId: string) {
  const order = await loadOrder(tx, orderId);
  if (order.status !== "ALLOCATED") throw new AppError("Only allocated orders can be picked");
  const allocated = order.items.reduce((s, i) => s + i.allocatedKg, 0);
  if (allocated <= EPS) throw new AppError("Nothing is allocated yet. Allocate stock first.");
  await setStatus(tx, ctx, order.id, "ALLOCATED", "PICKING");
}

/** Records actual picked weights (variable-weight goods). Releases unpicked reservations. */
export async function completePicking(tx: Tx, ctx: ServiceCtx, orderId: string, picked: Record<string, number> = {}) {
  const order = await loadOrder(tx, orderId);
  if (order.status !== "PICKING") throw new AppError("The order is not in picking");
  for (const item of order.items) {
    let itemPicked = 0;
    for (const a of item.allocations.filter((x) => x.status === "RESERVED")) {
      const qty = picked[a.id] !== undefined ? round(picked[a.id], 3) : a.quantityKg;
      if (qty < 0) throw new AppError("Picked quantity cannot be negative");
      const lot = await tx.inventory.findUniqueOrThrow({ where: { id: a.inventoryId } });
      const maxPossible = lot.quantityKg - lot.reservedKg + a.quantityKg;
      if (qty > maxPossible + EPS) throw new AppError("Picked quantity exceeds lot stock ({kg} kg)", { kg: round(maxPossible, 3) });
      if (qty > item.quantityKg * 1.1 + EPS) throw new AppError("Picked quantity is more than 10% above the ordered quantity");
      await tx.inventory.update({ where: { id: lot.id }, data: { reservedKg: Math.max(0, round(lot.reservedKg - a.quantityKg + qty, 3)) } });
      await tx.orderAllocation.update({ where: { id: a.id }, data: { quantityKg: qty, status: qty > EPS ? "PICKED" : "RELEASED" } });
      itemPicked += qty;
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { pickedKg: round(itemPicked, 3), allocatedKg: round(itemPicked, 3) } });
  }
  await setStatus(tx, ctx, order.id, "PICKING", "READY_FOR_DISPATCH");
}

/** Deducts picked stock (SHIPMENT movements) and moves the order to In Delivery. */
export async function dispatchOrder(tx: Tx, ctx: ServiceCtx, orderId: string, shipment?: { id: string; number: string; vehiclePlate: string }) {
  const order = await loadOrder(tx, orderId);
  if (order.status !== "READY_FOR_DISPATCH") throw new AppError("Order {number} is not ready for dispatch", { number: order.number });
  for (const item of order.items) {
    for (const a of item.allocations.filter((x) => x.status === "PICKED")) {
      await removeStock(tx, ctx, {
        inventoryId: a.inventoryId,
        quantityKg: a.quantityKg,
        type: "SHIPMENT",
        fromReserved: a.quantityKg,
        referenceType: "ORDER",
        referenceId: order.id,
        reason: `Order ${order.number}${shipment ? " / " + shipment.number : ""}`,
      });
      await tx.orderAllocation.update({ where: { id: a.id }, data: { status: "SHIPPED" } });
      await traceEvent(tx, ctx, {
        batchId: a.batchId,
        eventType: "SHIPPED",
        description: `${item.product.name}: ${a.quantityKg} kg dispatched to ${order.customer.name} (order ${order.number}${shipment ? ", shipment " + shipment.number + ", vehicle " + shipment.vehiclePlate : ""})`,
        quantityKg: a.quantityKg,
        location: order.customer.name,
        entityType: shipment ? "shipment" : "order",
        entityId: shipment?.id ?? order.id,
      });
    }
  }
  await setStatus(tx, ctx, order.id, "READY_FOR_DISPATCH", "IN_DELIVERY", shipment ? `Shipment ${shipment.number}` : "Dispatched (own transport / pickup)", { dispatchedAt: nowOf(ctx) });
}

/**
 * Confirms delivery. `delivered` maps orderItemId → delivered kg (defaults to shipped).
 * Computes OTIF and issues the sales invoice for the delivered quantity.
 */
export async function confirmDelivery(
  tx: Tx,
  ctx: ServiceCtx,
  orderId: string,
  input: { delivered?: Record<string, number>; receivedBy?: string | null; note?: string | null } = {},
) {
  const order = await loadOrder(tx, orderId);
  if (order.status !== "IN_DELIVERY") throw new AppError("Order {number} is not in delivery", { number: order.number });
  const at = nowOf(ctx);
  let amount = 0;
  let inFull = true;
  for (const item of order.items) {
    const shipped = round(item.allocations.filter((a) => a.status === "SHIPPED").reduce((s, a) => s + a.quantityKg, 0), 3);
    const delivered = input.delivered?.[item.id] !== undefined ? round(input.delivered[item.id], 3) : shipped;
    if (delivered < 0 || delivered > shipped + EPS) throw new AppError("Delivered quantity must be between 0 and the shipped quantity ({kg} kg)", { kg: shipped });
    await tx.orderItem.update({ where: { id: item.id }, data: { deliveredKg: delivered } });
    amount += delivered * num(item.unitPrice);
    if (delivered < item.quantityKg * (1 - ctx.settings.inFullTolerancePct / 100) - EPS) inFull = false;
    for (const a of item.allocations.filter((x) => x.status === "SHIPPED")) {
      await traceEvent(tx, ctx, {
        batchId: a.batchId,
        eventType: "DELIVERED",
        description: `${item.product.name} delivered to ${order.customer.name} (order ${order.number})${input.receivedBy ? ", received by " + input.receivedBy : ""}`,
        quantityKg: a.quantityKg,
        location: order.customer.name,
        entityType: "order",
        entityId: order.id,
        at,
      });
    }
  }
  const deliveredKey = localDateKey(at, ctx.tz);
  const onTime = deliveredKey <= dateOnlyKey(order.requestedDeliveryDate);
  const status: OrderStatus = inFull ? "DELIVERED" : "PARTIALLY_DELIVERED";
  amount = round(amount, 2);
  await setStatus(tx, ctx, order.id, "IN_DELIVERY", status, input.note ?? (input.receivedBy ? `Received by ${input.receivedBy}` : undefined), {
    deliveredAt: at,
    onTime,
    inFull,
    total: amount,
  });
  const invNumber = await nextNumber(tx, ctx, "INV");
  await tx.salesInvoice.create({
    data: {
      tenantId: ctx.tenantId,
      number: invNumber,
      orderId: order.id,
      customerId: order.customerId,
      amount,
      issuedAt: at,
      dueAt: addDays(at, order.customer.paymentTermsDays || ctx.settings.defaultPaymentTermsDays),
      createdAt: at,
    },
  });
  return { status, onTime, inFull, amount, invoiceNumber: invNumber };
}

export async function cancelOrder(tx: Tx, ctx: ServiceCtx, orderId: string, reason: string) {
  const order = await loadOrder(tx, orderId);
  if (!CANCELLABLE.includes(order.status)) throw new AppError("Orders in status {status} cannot be cancelled", { status: order.status });
  assert(reason && reason.length >= 3, "Please provide a cancellation reason");
  await releaseAllocations(tx, ctx, order);
  await tx.shipmentOrder.deleteMany({ where: { orderId: order.id, status: "PENDING" } });
  await setStatus(tx, ctx, order.id, order.status, "CANCELLED", reason, { cancelledAt: nowOf(ctx), cancelReason: reason });
}

/** Returns allocation back to ALLOCATED state (e.g., pick list printed by mistake). */
export async function updateOrderItems(tx: Tx, ctx: ServiceCtx, orderId: string, items: { productId: string; quantityKg: number }[]) {
  const order = await loadOrder(tx, orderId);
  if (order.status !== "NEW" && order.status !== "CONFIRMED") throw new AppError("Items can only be changed before allocation");
  await tx.orderItem.deleteMany({ where: { orderId } });
  let subtotal = 0;
  for (const it of items) {
    assert(it.quantityKg > 0, "Quantities must be greater than zero");
    const unitPrice = await priceFor(tx, order.customerId, it.productId);
    const lineTotal = round(unitPrice * it.quantityKg, 2);
    subtotal += lineTotal;
    await tx.orderItem.create({ data: { tenantId: ctx.tenantId, orderId, productId: it.productId, quantityKg: it.quantityKg, unitPrice, lineTotal } });
  }
  await tx.order.update({ where: { id: orderId }, data: { subtotal: round(subtotal, 2), total: round(subtotal, 2) } });
  await audit(tx, ctx, { action: "order.items_update", entityType: "order", entityId: orderId, summary: `${items.length} line(s), ${round(subtotal, 2)} UZS` });
}

export async function recordInvoicePayment(tx: Tx, ctx: ServiceCtx, input: { invoiceId: string; amount: number; paidAt: Date; method: string; reference?: string | null }) {
  const inv = await tx.salesInvoice.findUnique({ where: { id: input.invoiceId } });
  assert(inv, "Invoice not found");
  if (inv.status === "VOID") throw new AppError("Invoice is void");
  const outstanding = round(num(inv.amount) - num(inv.paidAmount), 2);
  assert(input.amount > 0, "Amount must be greater than zero", {}, "amount");
  if (input.amount > outstanding + 0.01) throw new AppError("Payment exceeds the outstanding amount ({amount})", { amount: outstanding }, "amount");
  await tx.invoicePayment.create({
    data: { tenantId: ctx.tenantId, invoiceId: inv.id, amount: input.amount, paidAt: input.paidAt, method: input.method, reference: input.reference ?? null, userId: ctx.userId ?? null },
  });
  const paid = round(num(inv.paidAmount) + input.amount, 2);
  await tx.salesInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: paid + 0.01 >= num(inv.amount) ? "PAID" : "PARTIAL" } });
  await audit(tx, ctx, { action: "invoice.payment", entityType: "sales_invoice", entityId: inv.id, summary: `${inv.number}: +${input.amount} (${input.method})`, changes: { paidAmount: { from: num(inv.paidAmount), to: paid } } });
}
