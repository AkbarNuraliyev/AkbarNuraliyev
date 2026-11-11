import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDay } from "@/lib/format";
import { toLocalInput } from "@/lib/tz";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui/basic";
import { spGet, type SP } from "@/components/ui/table";
import { ShipmentForm } from "./shipment-form";

export default async function NewShipmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "logistics.operate" });
  const sp = await searchParams;
  const data = await withTenant(ctx, async (tx) => {
    const [vehicles, drivers, routes, orders] = await Promise.all([
      tx.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" } }),
      tx.driver.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      tx.deliveryRoute.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
      tx.order.findMany({
        where: { status: "READY_FOR_DISPATCH", stops: { none: { status: "PENDING", shipment: { status: { not: "CANCELLED" } } } } },
        include: { customer: true, items: { include: { product: true } } },
        orderBy: { requestedDeliveryDate: "asc" },
      }),
    ]);
    return { vehicles, drivers, routes, orders };
  });
  const t = ctx.t;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t("Logistics & Fleet"), href: "/app/logistics" }, { label: t("Plan shipment") }]} title={t("Plan shipment")} description={t("Assign ready orders to a vehicle and driver. Departure deducts stock and moves orders to In Delivery.")} />
      {data.orders.length === 0 ? (
        <EmptyState title={t("No orders are ready for dispatch")} description={t("Orders appear here after picking is completed.")} action={<LinkButton href="/app/orders?status=PICKING">{t("Orders in picking")}</LinkButton>} />
      ) : (
        <Card>
          <ShipmentForm
            vehicles={data.vehicles.map((v) => ({ id: v.id, label: `${v.plate} — ${v.model ?? ""} (${v.type.toLowerCase()}, ${v.capacityKg ?? "?"} kg)`, type: v.type, capacity: v.capacityKg }))}
            drivers={data.drivers.map((d) => ({ id: d.id, label: d.name, expired: !!d.licenseExpiry && d.licenseExpiry < new Date() }))}
            routes={data.routes.map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` }))}
            orders={data.orders.map((o) => ({
              id: o.id,
              label: `${o.number} · ${o.customer.name}`,
              sub: `${t("Delivery")} ${fmtDay(o.requestedDeliveryDate)} · ${o.customer.region ?? ""}`,
              kg: o.items.reduce((s, i) => s + i.pickedKg, 0),
              frozenOnly: o.items.every((i) => i.product.storageType === "FROZEN"),
            }))}
            preselect={spGet(sp, "order")}
            defaultDeparture={toLocalInput(new Date(Date.now() + 3600000), ctx.tz)}
          />
        </Card>
      )}
    </>
  );
}
