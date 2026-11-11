/**
 * Prepares a COPY of the demo database for recording the role tutorial videos:
 * takes three new orders through confirm → FEFO allocation → picking and plans a
 * chilled shipment for today for the demo driver, so the driver app shows real actions.
 * Usage: DATABASE_URL=<copy of the demo DB> npx tsx scripts/video/prep-video-db.ts
 */
import { withSystem, withTenant } from "@/lib/db";
import { parseSettings } from "@/lib/settings";
import { allocateOrder, completePicking, confirmOrder, startPicking } from "@/server/services/orders";
import { createShipment } from "@/server/services/logistics";

async function main() {
  if (!/poultryos_video/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run: DATABASE_URL must point to the poultryos_video copy");
  const tenant = await withSystem((tx) => tx.tenant.findFirstOrThrow({ where: { isDemo: true } }));
  const ctx = { tenantId: tenant.id, tz: tenant.timezone, settings: parseSettings(tenant.settings), userName: "Диспетчер (подготовка демо)", userEmail: "demo-dispatch" };
  await withTenant(ctx, async (tx) => {
    const driver = await tx.driver.findFirstOrThrow({ where: { userId: { not: null } } });
    const vehicle = await tx.vehicle.findFirstOrThrow({ where: { isActive: true, type: { not: "FREEZER" } }, orderBy: { capacityKg: "desc" } });
    const orders = await tx.order.findMany({ where: { status: "NEW" }, orderBy: { requestedDeliveryDate: "asc" }, take: 3 });
    const ready: string[] = [];
    for (const o of orders) {
      await confirmOrder(tx, ctx, o.id);
      await allocateOrder(tx, ctx, o.id);
      await startPicking(tx, ctx, o.id);
      await completePicking(tx, ctx, o.id);
      ready.push(o.id);
    }
    const dep = new Date(Date.now() + 30 * 60000);
    const sh = await createShipment(tx, ctx, { vehicleId: vehicle.id, driverId: driver.id, plannedDeparture: dep, temperatureMode: "CHILLED", orderIds: ready });
    console.log(`planned shipment ${sh.number} with ${ready.length} orders for driver ${driver.name}`);
  });
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
