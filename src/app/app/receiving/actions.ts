"use server";

import { z } from "zod";
import { defineAction, zBool, zDateTime, zId, zNum, zOptNum, zOptStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { zonedDateTime } from "@/lib/tz";
import { createReceipt } from "@/server/services/receiving";
import { recordQuality } from "@/server/services/quality";

const schema = z.object({
  supplierId: zId,
  farmId: zId,
  facilityId: z.string().optional(),
  receivedAt: zDateTime,
  vehiclePlate: zOptStr(30),
  driverName: zOptStr(120),
  birdsDeclared: zNum({ min: 0, max: 200000, int: true }),
  birdsReceived: zNum({ min: 1, max: 200000, int: true }),
  birdsDeadOnArrival: zNum({ min: 0, max: 200000, int: true }),
  birdsRejected: zNum({ min: 0, max: 200000, int: true }),
  grossWeightKg: zNum({ min: 0.1, max: 200000 }),
  tareWeightKg: zNum({ min: 0, max: 200000 }),
  rejectedWeightKg: zOptNum({ min: 0, max: 200000 }),
  weighingSource: z.enum(["MANUAL", "SCALE"]).default("MANUAL"),
  scaleDeviceId: zOptStr(60),
  qualityGrade: zOptStr(10),
  bodyTempC: zOptNum({ min: 30, max: 45 }),
  vetCertificateNo: zOptStr(60),
  feedWithdrawalHours: zOptNum({ min: 0, max: 48 }),
  appearanceOk: zBool,
  bruisingPct: zOptNum({ min: 0, max: 100 }),
  decision: z.enum(["ACCEPTED", "PARTIAL", "REJECTED"], { errorMap: () => ({ message: "Select a decision" }) }),
  rejectionReason: zOptStr(500),
  inspectionNotes: zOptStr(2000),
  pricePerKg: zOptNum({ min: 0, max: 10_000_000 }),
  checklistId: z.string().optional(),
});

export const createReceiptAction = defineAction({ permission: "receiving.operate", schema }, async (ctx, input, fd) => {
  const receivedAt = zonedDateTime(input.receivedAt, ctx.tz);
  const { checklistId, receivedAt: _r, facilityId, ...rest } = input;
  void _r;
  const result = await withTenant(ctx, async (tx) => {
    const r = await createReceipt(tx, ctx, { ...rest, receivedAt, facilityId: facilityId || null, rejectedWeightKg: rest.rejectedWeightKg ?? null }, { batchFormat: ctx.tenant.batchFormat, batchPrefix: ctx.tenant.batchPrefix });
    if (checklistId) {
      const responses: Record<string, string | undefined> = {};
      for (const [k, v] of fd.entries()) if (k.startsWith("r_") && typeof v === "string") responses[k.slice(2)] = v;
      if (Object.keys(responses).length) {
        await recordQuality(tx, ctx, { checklistId, area: "Live bird receiving", entityType: "raw_material_receipt", entityId: r.receipt.id, batchId: r.batch.id, responses, notes: input.inspectionNotes });
      }
    }
    return r;
  });
  return { ok: true, message: "Delivery saved. Batch {code} created.", params: { code: result.batch.code }, redirectTo: `/app/receiving/${result.receipt.id}` };
});

/** Latest stable reading from a scale gateway (posted to /api/v1/scale-readings). Never fabricates a weight. */
const scaleSchema = z.object({ deviceId: z.string().min(1, "Enter the scale device ID") });

export const readScaleAction = defineAction({ permission: "receiving.operate", schema: scaleSchema }, async (ctx, input) => {
  const reading = await withTenant(ctx, async (tx) => {
    const integ = await tx.integration.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: "scales" } } });
    const r = await tx.scaleReading.findFirst({ where: { deviceId: input.deviceId, stable: true, consumedAt: null, readAt: { gte: new Date(Date.now() - 5 * 60000) } }, orderBy: { readAt: "desc" } });
    if (!r) {
      throw new AppError(
        integ?.status === "CONNECTED"
          ? "No stable reading from scale {device} in the last 5 minutes."
          : "No reading available: the scale integration is not connected. Enter the weight manually.",
        { device: input.deviceId },
      );
    }
    await tx.scaleReading.update({ where: { id: r.id }, data: { consumedAt: new Date() } });
    return r;
  });
  return { ok: true, message: "Scale reading received: {kg} kg", params: { kg: reading.weightKg }, data: { weightKg: reading.weightKg, deviceId: reading.deviceId, readAt: reading.readAt.toISOString() } };
});
