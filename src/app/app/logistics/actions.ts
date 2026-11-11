"use server";

import { z } from "zod";
import { defineAction, zDateTime, zId, zJson, zNum, zOptNum, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { zonedDateTime } from "@/lib/tz";
import { audit } from "@/server/core";
import { cancelShipment, confirmStop, createShipment, departShipment, recordTemperature } from "@/server/services/logistics";

const vehicleSchema = z.object({
  plate: zStr(20),
  model: zOptStr(80),
  type: z.enum(["REFRIGERATED", "FREEZER", "VAN"]),
  capacityKg: zOptNum({ min: 0, max: 60000 }),
  telematicsProvider: zOptStr(30),
  telematicsDeviceId: zOptStr(60),
});
export const createVehicleAction = defineAction({ permission: "logistics.manage", schema: vehicleSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const plate = input.plate.toUpperCase();
    if (await tx.vehicle.findUnique({ where: { tenantId_plate: { tenantId: ctx.tenantId, plate } } })) throw new AppError("A vehicle with this plate exists", {}, "plate");
    const v = await tx.vehicle.create({ data: { tenantId: ctx.tenantId, ...input, plate, capacityKg: input.capacityKg ?? null, tempMinC: input.type === "FREEZER" ? null : 0, tempMaxC: input.type === "FREEZER" ? -18 : 4 } });
    await audit(tx, ctx, { action: "vehicle.create", entityType: "vehicle", entityId: v.id, summary: v.plate });
  });
  return { ok: true, message: "Vehicle added" };
});

const driverSchema = z.object({ name: zStr(120), phone: zOptStr(40), licenseNumber: zOptStr(40), licenseExpiry: z.string().optional(), userId: zOptStr(40) });
export const createDriverAction = defineAction({ permission: "logistics.manage", schema: driverSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const d = await tx.driver.create({ data: { tenantId: ctx.tenantId, ...input, licenseExpiry: input.licenseExpiry ? new Date(`${input.licenseExpiry}T00:00:00Z`) : null } });
    await audit(tx, ctx, { action: "driver.create", entityType: "driver", entityId: d.id, summary: d.name });
  });
  return { ok: true, message: "Driver added" };
});

const routeSchema = z.object({ code: zStr(20), name: zStr(120), description: zOptStr(300), regions: zOptStr(300), estimatedDurationMin: zOptNum({ min: 0, int: true }) });
export const createRouteAction = defineAction({ permission: "logistics.manage", schema: routeSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const code = input.code.toUpperCase();
    if (await tx.deliveryRoute.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } })) throw new AppError("Route code already exists", {}, "code");
    const r = await tx.deliveryRoute.create({
      data: { tenantId: ctx.tenantId, code, name: input.name, description: input.description, regions: (input.regions ?? "").split(",").map((s) => s.trim()).filter(Boolean), estimatedDurationMin: input.estimatedDurationMin ?? null },
    });
    await audit(tx, ctx, { action: "route.create", entityType: "delivery_route", entityId: r.id, summary: r.name });
  });
  return { ok: true, message: "Route created" };
});

const shipmentSchema = z.object({
  vehicleId: zId,
  driverId: zId,
  routeId: zOptStr(40),
  plannedDeparture: zDateTime,
  temperatureMode: z.enum(["CHILLED", "FROZEN"]),
  notes: zOptStr(500),
  orderIds: zJson(z.array(z.string()).min(1, "Select at least one order")),
});
export const createShipmentAction = defineAction({ permission: "logistics.operate", schema: shipmentSchema }, async (ctx, input) => {
  const sh = await withTenant(ctx, (tx) => createShipment(tx, ctx, { ...input, plannedDeparture: zonedDateTime(input.plannedDeparture, ctx.tz) }));
  return { ok: true, message: "Shipment {n} planned", params: { n: sh.number }, redirectTo: `/app/logistics/shipments/${sh.id}` };
});

const idSchema = z.object({ id: zId });
export const departShipmentAction = defineAction({ permission: "logistics.operate", schema: idSchema }, async (ctx, { id }) => {
  await withTenant(ctx, (tx) => departShipment(tx, ctx, id));
  return { ok: true, message: "Shipment departed — orders are in delivery and stock is deducted" };
});

export const cancelShipmentAction = defineAction({ permission: "logistics.manage", schema: idSchema }, async (ctx, { id }) => {
  await withTenant(ctx, (tx) => cancelShipment(tx, ctx, id));
  return { ok: true, message: "Shipment cancelled — orders remain ready for dispatch" };
});

const stopSchema = z.object({ shipmentId: zId, orderId: zId, receivedBy: zStr(120), notes: zOptStr(500) });
export const confirmStopAction = defineAction({ permission: "logistics.operate", schema: stopSchema }, async (ctx, input, fd) => {
  const delivered: Record<string, number> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("d_") && typeof v === "string" && v !== "") delivered[k.slice(2)] = Number(v.replace(",", "."));
  const r = await withTenant(ctx, (tx) => confirmStop(tx, ctx, { ...input, delivered }));
  return { ok: true, message: r.inFull ? "Delivery confirmed in full" : "Partial delivery confirmed" };
});

const tempSchema = z.object({
  sourceType: z.enum(["VEHICLE", "CHAMBER"]),
  chamberId: zOptStr(40),
  shipmentId: zOptStr(40),
  vehicleId: zOptStr(40),
  temperatureC: zNum({ min: -50, max: 60 }),
  recordedAt: zDateTime,
});
export const recordTemperatureAction = defineAction({ permission: "logistics.operate", schema: tempSchema }, async (ctx, input) => {
  const r = await withTenant(ctx, (tx) => recordTemperature(tx, ctx, { ...input, recordedAt: zonedDateTime(input.recordedAt, ctx.tz), dataSource: "MANUAL" }));
  return { ok: true, message: r.isExcursion ? "Reading saved — EXCURSION: outside the permitted range, alert raised" : "Reading saved (within limits)" };
});
