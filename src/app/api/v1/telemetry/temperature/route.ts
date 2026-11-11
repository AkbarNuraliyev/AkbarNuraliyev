import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { apiAuth, apiError, apiRun } from "@/server/api";
import { recordTemperature } from "@/server/services/logistics";

export const dynamic = "force-dynamic";

const schema = z.object({
  readings: z
    .array(
      z.object({
        chamber_code: z.string().optional(),
        shipment_number: z.string().optional(),
        vehicle_plate: z.string().optional(),
        temperature_c: z.number().min(-50).max(60),
        recorded_at: z.string().datetime(),
        device_id: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** Device / gateway ingestion. Readings are stored with dataSource DEVICE. */
export async function POST(req: NextRequest) {
  const ctx = await apiAuth(req, "telemetry:write");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, `Invalid body: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return apiRun(
    ctx,
    async (tx) => {
      let excursions = 0;
      for (const r of parsed.data.readings) {
        let chamberId: string | null = null;
        let shipmentId: string | null = null;
        let vehicleId: string | null = null;
        if (r.chamber_code) chamberId = (await tx.storageChamber.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code: r.chamber_code } } }))?.id ?? null;
        if (r.shipment_number) shipmentId = (await tx.shipment.findUnique({ where: { tenantId_number: { tenantId: ctx.tenantId, number: r.shipment_number } } }))?.id ?? null;
        if (r.vehicle_plate) vehicleId = (await tx.vehicle.findUnique({ where: { tenantId_plate: { tenantId: ctx.tenantId, plate: r.vehicle_plate } } }))?.id ?? null;
        if (!chamberId && !shipmentId && !vehicleId) throw new AppError("Unknown chamber/shipment/vehicle in reading");
        const saved = await recordTemperature(tx, ctx, {
          sourceType: chamberId ? "CHAMBER" : "VEHICLE",
          chamberId,
          shipmentId,
          vehicleId,
          temperatureC: r.temperature_c,
          recordedAt: new Date(r.recorded_at),
          dataSource: "DEVICE",
          deviceId: r.device_id,
        });
        if (saved.isExcursion) excursions++;
      }
      return { accepted: parsed.data.readings.length, excursions };
    },
    201,
  );
}
