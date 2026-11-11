import type { Tx } from "@/lib/prisma";
import type { DataSource, StorageType } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { round } from "@/lib/format";
import { tempLimits } from "@/lib/settings";
import { audit, nextNumber, notify, nowOf, type ServiceCtx } from "../core";
import { confirmDelivery, dispatchOrder } from "./orders";
import { emitWebhook } from "./webhooks";

export async function createShipment(
  tx: Tx,
  ctx: ServiceCtx,
  input: { vehicleId: string; driverId: string; routeId?: string | null; plannedDeparture: Date; temperatureMode: StorageType; orderIds: string[]; notes?: string | null },
) {
  const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
  assert(vehicle && vehicle.isActive, "Vehicle not found", {}, "vehicleId");
  const driver = await tx.driver.findUnique({ where: { id: input.driverId } });
  assert(driver && driver.isActive, "Driver not found", {}, "driverId");
  if (driver.licenseExpiry && driver.licenseExpiry < nowOf(ctx)) throw new AppError("The driver's licence has expired", {}, "driverId");
  if (input.temperatureMode === "FROZEN" && vehicle.type !== "FREEZER") throw new AppError("Frozen shipments require a freezer vehicle", {}, "vehicleId");
  assert(input.orderIds.length > 0, "Select at least one order", {}, "orderIds");
  const orders = await tx.order.findMany({ where: { id: { in: input.orderIds } }, include: { items: true, stops: { include: { shipment: true } } } });
  assert(orders.length === input.orderIds.length, "Some orders were not found");
  let weight = 0;
  for (const o of orders) {
    if (o.status !== "READY_FOR_DISPATCH") throw new AppError("Order {number} is not ready for dispatch", { number: o.number });
    if (o.stops.some((s) => s.shipment.status !== "CANCELLED" && s.status === "PENDING"))
      throw new AppError("Order {number} is already assigned to a shipment", { number: o.number });
    weight += o.items.reduce((s, i) => s + i.pickedKg, 0);
  }
  if (vehicle.capacityKg && weight > vehicle.capacityKg)
    throw new AppError("Total weight {kg} kg exceeds vehicle capacity ({cap} kg)", { kg: round(weight, 0), cap: vehicle.capacityKg }, "vehicleId");
  const number = await nextNumber(tx, ctx, "SHP");
  const shipment = await tx.shipment.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      vehicleId: vehicle.id,
      driverId: driver.id,
      routeId: input.routeId ?? null,
      plannedDeparture: input.plannedDeparture,
      temperatureMode: input.temperatureMode,
      notes: input.notes ?? null,
      createdById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
      stops: { create: input.orderIds.map((orderId, i) => ({ tenantId: ctx.tenantId, orderId, sequence: i + 1 })) },
    },
  });
  await audit(tx, ctx, { action: "shipment.create", entityType: "shipment", entityId: shipment.id, summary: `${number}: ${orders.length} order(s), ${round(weight, 1)} kg, ${vehicle.plate}` });
  return shipment;
}

export async function departShipment(tx: Tx, ctx: ServiceCtx, shipmentId: string) {
  const sh = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { vehicle: true, stops: true } });
  assert(sh, "Shipment not found");
  if (sh.status !== "PLANNED" && sh.status !== "LOADING") throw new AppError("Shipment has already departed");
  for (const stop of sh.stops) await dispatchOrder(tx, ctx, stop.orderId, { id: sh.id, number: sh.number, vehiclePlate: sh.vehicle.plate });
  await tx.shipment.update({ where: { id: sh.id }, data: { status: "IN_TRANSIT", departedAt: nowOf(ctx) } });
  await audit(tx, ctx, { action: "shipment.depart", entityType: "shipment", entityId: sh.id, summary: sh.number });
  await emitWebhook(tx, ctx, "shipment.departed", { shipment: sh.number, vehicle: sh.vehicle.plate });
}

export async function confirmStop(
  tx: Tx,
  ctx: ServiceCtx,
  input: { shipmentId: string; orderId: string; receivedBy: string; delivered?: Record<string, number>; notes?: string | null },
) {
  const sh = await tx.shipment.findUnique({ where: { id: input.shipmentId }, include: { stops: true } });
  assert(sh, "Shipment not found");
  if (sh.status !== "IN_TRANSIT") throw new AppError("Shipment is not in transit");
  const stop = sh.stops.find((s) => s.orderId === input.orderId);
  assert(stop, "This order is not part of the shipment");
  if (stop.status !== "PENDING") throw new AppError("This stop is already confirmed");
  assert(input.receivedBy && input.receivedBy.length >= 2, "Enter the name of the person who received the goods", {}, "receivedBy");
  const r = await confirmDelivery(tx, ctx, input.orderId, { delivered: input.delivered, receivedBy: input.receivedBy, note: input.notes });
  await tx.shipmentOrder.update({
    where: { id: stop.id },
    data: { status: r.inFull ? "DELIVERED" : "PARTIAL", deliveredAt: nowOf(ctx), receivedBy: input.receivedBy, notes: input.notes ?? null },
  });
  const remaining = await tx.shipmentOrder.count({ where: { shipmentId: sh.id, status: "PENDING" } });
  if (remaining === 0) {
    const partial = await tx.shipmentOrder.count({ where: { shipmentId: sh.id, status: { in: ["PARTIAL", "FAILED"] } } });
    await tx.shipment.update({ where: { id: sh.id }, data: { status: partial ? "PARTIALLY_DELIVERED" : "DELIVERED", arrivedAt: nowOf(ctx) } });
    await emitWebhook(tx, ctx, "shipment.delivered", { shipment: sh.number });
  }
  return r;
}

export async function cancelShipment(tx: Tx, ctx: ServiceCtx, shipmentId: string) {
  const sh = await tx.shipment.findUnique({ where: { id: shipmentId } });
  assert(sh, "Shipment not found");
  if (sh.status !== "PLANNED" && sh.status !== "LOADING") throw new AppError("Only planned shipments can be cancelled");
  await tx.shipmentOrder.deleteMany({ where: { shipmentId } });
  await tx.shipment.update({ where: { id: shipmentId }, data: { status: "CANCELLED" } });
  await audit(tx, ctx, { action: "shipment.cancel", entityType: "shipment", entityId: shipmentId, summary: sh.number });
}

/** Records a temperature reading (manual, demo or device) and raises an excursion alert when limits are exceeded. */
export async function recordTemperature(
  tx: Tx,
  ctx: ServiceCtx,
  input: {
    sourceType: "VEHICLE" | "CHAMBER";
    chamberId?: string | null;
    shipmentId?: string | null;
    vehicleId?: string | null;
    temperatureC: number;
    recordedAt: Date;
    dataSource: DataSource;
    deviceId?: string | null;
  },
) {
  assert(input.temperatureC > -50 && input.temperatureC < 60, "Temperature value is out of the sensor range", {}, "temperatureC");
  let min: number | null = null;
  let max: number | null = null;
  let label = "";
  let link = "";
  let vehicleId = input.vehicleId ?? null;
  if (input.sourceType === "CHAMBER") {
    const ch = await tx.storageChamber.findUnique({ where: { id: input.chamberId ?? "" }, include: { warehouse: true } });
    assert(ch, "Storage chamber not found", {}, "chamberId");
    const lim = tempLimits(ctx.settings, ch.type);
    min = ch.minTempC ?? lim.min;
    max = ch.maxTempC ?? lim.max;
    label = `${ch.warehouse.name} / ${ch.name}`;
    link = `/app/logistics/temperature?chamber=${ch.id}`;
  } else {
    const sh = input.shipmentId ? await tx.shipment.findUnique({ where: { id: input.shipmentId }, include: { vehicle: true } }) : null;
    if (input.shipmentId) assert(sh, "Shipment not found", {}, "shipmentId");
    vehicleId = sh?.vehicleId ?? vehicleId;
    assert(vehicleId, "Select a vehicle or shipment", {}, "vehicleId");
    const vehicle = sh?.vehicle ?? (await tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId } }));
    const lim = tempLimits(ctx.settings, sh?.temperatureMode ?? (vehicle.type === "FREEZER" ? "FROZEN" : "CHILLED"));
    min = lim.min;
    max = lim.max;
    label = `${vehicle.plate}${sh ? " / " + sh.number : ""}`;
    link = sh ? `/app/logistics/shipments/${sh.id}` : `/app/logistics/temperature`;
  }
  const isExcursion = (max !== null && input.temperatureC > max) || (min !== null && input.temperatureC < min);
  const reading = await tx.temperatureReading.create({
    data: {
      tenantId: ctx.tenantId,
      sourceType: input.sourceType,
      chamberId: input.chamberId ?? null,
      shipmentId: input.shipmentId ?? null,
      vehicleId,
      temperatureC: input.temperatureC,
      recordedAt: input.recordedAt,
      dataSource: input.dataSource,
      deviceId: input.deviceId ?? null,
      isExcursion,
      limitMinC: min,
      limitMaxC: max,
      recordedById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  if (isExcursion) {
    const hourKey = input.recordedAt.toISOString().slice(0, 13);
    const created = await notify(tx, ctx, {
      type: "TEMP_EXCURSION",
      severity: "CRITICAL",
      title: `Temperature excursion: ${label}`,
      message: `${input.temperatureC > 0 ? "+" : ""}${input.temperatureC} °C recorded (${input.dataSource.toLowerCase()} reading), allowed ${min ?? "—"} … ${max ?? "—"} °C.`,
      link,
      entityType: input.sourceType === "CHAMBER" ? "storage_chamber" : "shipment",
      entityId: input.chamberId ?? input.shipmentId ?? vehicleId ?? undefined,
      dedupeKey: `temp:${input.chamberId ?? input.shipmentId ?? vehicleId}:${hourKey}`,
    });
    if (created) await emitWebhook(tx, ctx, "temperature.excursion", { source: label, temperatureC: input.temperatureC, limitMaxC: max, limitMinC: min, dataSource: input.dataSource });
  }
  return reading;
}
