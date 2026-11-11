import type { Tx } from "@/lib/prisma";
import { AppError, assert } from "@/lib/errors";
import { round } from "@/lib/format";
import { localDateKey } from "@/lib/tz";
import { shortCode } from "@/lib/crypto";
import { audit, nextNumber, nextSequence, notify, nowOf, renderBatchCode, traceEvent, type ServiceCtx } from "../core";
import { emitWebhook } from "./webhooks";

export interface ReceiptInput {
  supplierId: string;
  farmId: string;
  facilityId?: string | null;
  receivedAt: Date;
  vehiclePlate?: string | null;
  driverName?: string | null;
  birdsDeclared: number;
  birdsReceived: number;
  birdsDeadOnArrival: number;
  birdsRejected: number;
  grossWeightKg: number;
  tareWeightKg: number;
  rejectedWeightKg?: number | null;
  weighingSource?: "MANUAL" | "SCALE";
  scaleDeviceId?: string | null;
  qualityGrade?: string | null;
  bodyTempC?: number | null;
  vetCertificateNo?: string | null;
  feedWithdrawalHours?: number | null;
  appearanceOk: boolean;
  bruisingPct?: number | null;
  decision: "ACCEPTED" | "PARTIAL" | "REJECTED";
  rejectionReason?: string | null;
  inspectionNotes?: string | null;
  pricePerKg?: number | null;
}

/** Pure validation + derived weights for a delivery. Exported for unit tests. */
export function computeReceipt(i: ReceiptInput) {
  const errors: Record<string, string> = {};
  if (i.birdsReceived <= 0) errors.birdsReceived = "Received birds must be greater than zero";
  if (i.birdsDeadOnArrival < 0 || i.birdsRejected < 0) errors.birdsRejected = "Counts cannot be negative";
  if (i.birdsDeadOnArrival + i.birdsRejected > i.birdsReceived)
    errors.birdsRejected = "Dead and rejected birds cannot exceed received birds";
  if (i.grossWeightKg <= 0) errors.grossWeightKg = "Gross weight must be greater than zero";
  if (i.tareWeightKg < 0) errors.tareWeightKg = "Tare weight cannot be negative";
  if (i.tareWeightKg >= i.grossWeightKg) errors.tareWeightKg = "Tare weight must be lower than gross weight";
  const netWeightKg = round(i.grossWeightKg - i.tareWeightKg, 3);
  const birdsAccepted = i.decision === "REJECTED" ? 0 : i.birdsReceived - i.birdsDeadOnArrival - i.birdsRejected;
  const avg = i.birdsReceived > 0 ? netWeightKg / i.birdsReceived : 0;
  if (i.birdsReceived > 0 && netWeightKg > 0 && (avg < 0.6 || avg > 5)) {
    errors.grossWeightKg = "Average live weight per bird is implausible ({avg} kg). Check weights and counts.";
  }
  let rejectedWeightKg: number;
  if (i.decision === "REJECTED") rejectedWeightKg = netWeightKg;
  else if (i.rejectedWeightKg !== null && i.rejectedWeightKg !== undefined) rejectedWeightKg = i.rejectedWeightKg;
  else rejectedWeightKg = round(avg * (i.birdsDeadOnArrival + i.birdsRejected), 3);
  if (rejectedWeightKg < 0 || rejectedWeightKg > netWeightKg) errors.rejectedWeightKg = "Rejected weight must be between 0 and the net weight";
  const acceptedWeightKg = round(netWeightKg - rejectedWeightKg, 3);
  if (i.decision === "ACCEPTED" && (i.birdsRejected > 0 || i.birdsDeadOnArrival > 0) && rejectedWeightKg > 0) {
    // Full acceptance with DOA is common; allowed, the weight of DOA is still deducted.
  }
  if (i.decision === "PARTIAL" && i.birdsRejected + i.birdsDeadOnArrival === 0 && rejectedWeightKg === 0)
    errors.birdsRejected = "Partial acceptance requires rejected birds or rejected weight";
  if (i.decision !== "ACCEPTED" && !i.rejectionReason) errors.rejectionReason = "Rejection reason is required";
  if (i.decision !== "REJECTED" && birdsAccepted <= 0) errors.birdsRejected = "No birds left to accept — use Reject";
  return {
    errors,
    netWeightKg,
    birdsAccepted,
    rejectedWeightKg,
    acceptedWeightKg: i.decision === "REJECTED" ? 0 : acceptedWeightKg,
    avgBirdWeightKg: round(avg, 3),
  };
}

export async function createReceipt(tx: Tx, ctx: ServiceCtx, input: ReceiptInput, opts: { batchFormat: string; batchPrefix: string }) {
  const c = computeReceipt(input);
  const firstErr = Object.entries(c.errors)[0];
  if (firstErr) throw new AppError(firstErr[1], { avg: c.avgBirdWeightKg }, firstErr[0]);

  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  assert(supplier && supplier.isActive, "Supplier not found or inactive", {}, "supplierId");
  const farm = await tx.farm.findUnique({ where: { id: input.farmId } });
  assert(farm && farm.supplierId === supplier.id, "The farm does not belong to the selected supplier", {}, "farmId");
  assert(farm.isActive, "Farm is inactive", {}, "farmId");
  const facility = input.facilityId
    ? await tx.facility.findUnique({ where: { id: input.facilityId } })
    : await tx.facility.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (input.receivedAt.getTime() > nowOf(ctx).getTime() + 10 * 60000) throw new AppError("Receiving time cannot be in the future", {}, "receivedAt");

  const dateKey = localDateKey(input.receivedAt, ctx.tz);
  const seqKey = /\{(YYYYMMDD|DD|MM)\}/.test(opts.batchFormat) ? `batch:${dateKey}` : "batch";
  const seq = await nextSequence(tx, ctx.tenantId, seqKey);
  const code = renderBatchCode(opts.batchFormat, {
    prefix: opts.batchPrefix,
    dateKey,
    farm: farm.code,
    supplier: supplier.code,
    facility: facility?.code ?? "",
    seq,
  });
  const number = await nextNumber(tx, ctx, "RCV");

  const receipt = await tx.rawMaterialReceipt.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      supplierId: supplier.id,
      farmId: farm.id,
      facilityId: facility?.id ?? null,
      receivedAt: input.receivedAt,
      vehiclePlate: input.vehiclePlate ?? null,
      driverName: input.driverName ?? null,
      birdsDeclared: input.birdsDeclared,
      birdsReceived: input.birdsReceived,
      birdsDeadOnArrival: input.birdsDeadOnArrival,
      birdsRejected: input.decision === "REJECTED" ? input.birdsReceived - input.birdsDeadOnArrival : input.birdsRejected,
      birdsAccepted: c.birdsAccepted,
      grossWeightKg: input.grossWeightKg,
      tareWeightKg: input.tareWeightKg,
      netWeightKg: c.netWeightKg,
      rejectedWeightKg: c.rejectedWeightKg,
      acceptedWeightKg: c.acceptedWeightKg,
      avgBirdWeightKg: c.avgBirdWeightKg,
      weighingSource: input.weighingSource ?? "MANUAL",
      scaleDeviceId: input.scaleDeviceId ?? null,
      status: input.decision,
      qualityGrade: input.qualityGrade ?? null,
      bodyTempC: input.bodyTempC ?? null,
      vetCertificateNo: input.vetCertificateNo ?? null,
      feedWithdrawalHours: input.feedWithdrawalHours ?? null,
      appearanceOk: input.appearanceOk,
      bruisingPct: input.bruisingPct ?? null,
      rejectionReason: input.rejectionReason ?? null,
      inspectionNotes: input.inspectionNotes ?? null,
      pricePerKg: input.pricePerKg ?? (supplier.pricePerKgLive ? Number(supplier.pricePerKgLive) : null),
      inspectorId: ctx.userId ?? null,
      createdById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });

  const batch = await tx.productionBatch.create({
    data: {
      tenantId: ctx.tenantId,
      code,
      receiptId: receipt.id,
      supplierId: supplier.id,
      farmId: farm.id,
      status: input.decision === "REJECTED" ? "REJECTED" : "RECEIVED",
      birds: c.birdsAccepted,
      liveWeightKg: c.acceptedWeightKg,
      publicToken: shortCode(12),
      createdAt: input.receivedAt,
    },
  });

  await traceEvent(tx, ctx, {
    batchId: batch.id,
    eventType: "RECEIVED",
    description: `${input.decision === "REJECTED" ? "Rejected" : input.decision === "PARTIAL" ? "Partially accepted" : "Accepted"} delivery ${number} from ${farm.name} (${supplier.name}): ${c.birdsAccepted} birds, ${c.acceptedWeightKg} kg live weight`,
    quantityKg: c.acceptedWeightKg,
    location: facility?.name ?? null,
    entityType: "receipt",
    entityId: receipt.id,
    at: input.receivedAt,
  });
  await audit(tx, ctx, {
    action: "receipt.create",
    entityType: "raw_material_receipt",
    entityId: receipt.id,
    summary: `${number} / batch ${code}: ${input.decision}, ${c.netWeightKg} kg net`,
  });
  if (input.decision !== "ACCEPTED") {
    await notify(tx, ctx, {
      type: "RECEIVING_REJECTION",
      severity: input.decision === "REJECTED" ? "CRITICAL" : "WARNING",
      title: `${input.decision === "REJECTED" ? "Delivery rejected" : "Delivery partially accepted"}: ${supplier.name}`,
      message: `${number} (${code}) — ${input.rejectionReason ?? ""}`,
      link: `/app/receiving/${receipt.id}`,
      entityType: "raw_material_receipt",
      entityId: receipt.id,
    });
  }
  await emitWebhook(tx, ctx, "batch.received", { receipt: number, batch: code, status: input.decision, acceptedWeightKg: c.acceptedWeightKg, birds: c.birdsAccepted });
  return { receipt, batch };
}
