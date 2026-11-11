import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuth, apiError, apiRun } from "@/server/api";

export const dynamic = "force-dynamic";

const schema = z.object({ device_id: z.string().min(1).max(60), weight_kg: z.number().positive().max(100000), stable: z.boolean().default(true), read_at: z.string().datetime().optional() });

/** Industrial scale gateway → stores a reading that the receiving form can pull ("Read from scale"). */
export async function POST(req: NextRequest) {
  const ctx = await apiAuth(req, "scales:write");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, `Invalid body: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const b = parsed.data;
  return apiRun(
    ctx,
    async (tx) => {
      const r = await tx.scaleReading.create({ data: { tenantId: ctx.tenantId, deviceId: b.device_id, weightKg: b.weight_kg, stable: b.stable, readAt: b.read_at ? new Date(b.read_at) : new Date() } });
      return { id: r.id, device_id: r.deviceId, weight_kg: r.weightKg, read_at: r.readAt.toISOString() };
    },
    201,
  );
}
