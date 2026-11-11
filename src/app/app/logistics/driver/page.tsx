import Link from "next/link";
import { MapPin, Phone, Thermometer } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtKg, fmtTemp, fmtTime } from "@/lib/format";
import { addDays, startOfLocalDay, toLocalInput } from "@/lib/tz";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SubmitButton, TextInput } from "@/components/ui/form";
import { confirmStopAction, departShipmentAction, recordTemperatureAction } from "../actions";

/** Mobile-first view for drivers: today's shipments, departure, temperature checks and proof of delivery. */
export default async function DriverApp() {
  const ctx = await requireApp({ permission: "logistics.view" });
  const today = startOfLocalDay(new Date(), ctx.tz);
  const data = await withTenant(ctx, async (tx) => {
    const driver = await tx.driver.findFirst({ where: { userId: ctx.userId } });
    const shipments = await tx.shipment.findMany({
      where: {
        ...(driver ? { driverId: driver.id } : {}),
        OR: [{ status: { in: ["PLANNED", "LOADING", "IN_TRANSIT"] } }, { plannedDeparture: { gte: today, lt: addDays(today, 1) } }],
      },
      include: {
        vehicle: true,
        driver: true,
        readings: { orderBy: { recordedAt: "desc" }, take: 1 },
        stops: { orderBy: { sequence: "asc" }, include: { order: { include: { customer: true, items: { include: { product: true } } } } } },
      },
      orderBy: { plannedDeparture: "asc" },
      take: driver ? 10 : 30,
    });
    return { driver, shipments };
  });
  const t = ctx.t;
  const can = ctx.can("logistics.operate");
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t("My deliveries")} description={data.driver ? `${data.driver.name} · ${t("today")}` : t("Not linked to a driver profile — showing today's active shipments.")} />
      {data.shipments.length === 0 && <EmptyState title={t("No shipments for today")} />}
      <div className="space-y-4">
        {data.shipments.map((sh) => (
          <Card key={sh.id}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <Link href={`/app/logistics/shipments/${sh.id}`} className="text-base font-semibold text-navy-700">{sh.number}</Link>
                <div className="text-[13px] text-ink-3">{sh.vehicle.plate} · {t("departure")} {fmtTime(sh.plannedDeparture, ctx.tz)}</div>
              </div>
              <StatusBadge status={sh.status} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-[13px]">
              <Thermometer className="h-4 w-4 text-ink-3" />
              {sh.readings[0] ? <span className={sh.readings[0].isExcursion ? "font-semibold text-red-700" : ""}>{fmtTemp(sh.readings[0].temperatureC)} · {fmtTime(sh.readings[0].recordedAt, ctx.tz)}</span> : t("No reading yet")}
              {sh.readings[0]?.dataSource === "DEMO" && <Pill tone="violet">{t("Demo data")}</Pill>}
            </div>
            {can && (sh.status === "PLANNED" || sh.status === "LOADING") && (
              <div className="mt-3">
                <ActionButton action={departShipmentAction} fields={{ id: sh.id }} variant="primary" size="lg" className="w-full" confirm="Start the trip?" confirmText="Confirms loading of all stops and deducts stock." confirmVariant="primary">
                  Start trip
                </ActionButton>
              </div>
            )}
            {can && sh.status === "IN_TRANSIT" && (
              <div className="mt-3">
                <Modal trigger={<><Thermometer className="h-4 w-4" />{t("Record body temperature")}</>} title="Record temperature" triggerSize="lg" triggerClassName="w-full">
                  <ActionForm action={recordTemperatureAction} className="space-y-3">
                    <Hidden name="sourceType" value="VEHICLE" />
                    <Hidden name="shipmentId" value={sh.id} />
                    <NumberInput name="temperatureC" label="Temperature" required suffix="°C" />
                    <Hidden name="recordedAt" value={toLocalInput(new Date(), ctx.tz)} />
                    <FormError />
                    <SubmitButton className="w-full" size="lg">Save</SubmitButton>
                  </ActionForm>
                </Modal>
              </div>
            )}
            <ol className="mt-4 space-y-3">
              {sh.stops.map((s) => (
                <li key={s.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{s.sequence}. {s.order.customer.name}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-ink-3"><MapPin className="h-3.5 w-3.5" />{s.order.deliveryAddress}</div>
                      {s.order.customer.phone && <a href={`tel:${s.order.customer.phone.replace(/\s/g, "")}`} className="mt-0.5 flex items-center gap-1 text-[12.5px] text-navy-700"><Phone className="h-3.5 w-3.5" />{s.order.customer.phone}</a>}
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="mt-1.5 text-[12.5px] text-ink-2">{s.order.number} · {fmtKg(s.order.items.reduce((a, i) => a + i.pickedKg, 0), 1)}</div>
                  {can && sh.status === "IN_TRANSIT" && s.status === "PENDING" && (
                    <div className="mt-2">
                      <Modal trigger={t("Confirm delivery")} title="Proof of delivery" triggerVariant="primary" triggerSize="lg" triggerClassName="w-full" description={s.order.customer.name}>
                        <ActionForm action={confirmStopAction} className="space-y-3">
                          <Hidden name="shipmentId" value={sh.id} />
                          <Hidden name="orderId" value={s.orderId} />
                          {s.order.items.map((i) => (
                            <label key={i.id} className="flex items-center justify-between gap-2 text-sm">
                              <span className="min-w-0 truncate">{i.product.name}</span>
                              <input name={`d_${i.id}`} type="number" step="any" min={0} max={i.pickedKg} defaultValue={i.pickedKg.toFixed(3)} className="input h-10 w-28 text-right" inputMode="decimal" />
                            </label>
                          ))}
                          <TextInput name="receivedBy" label="Received by (name)" required />
                          <TextInput name="notes" label="Note" />
                          <FormError />
                          <SubmitButton className="w-full" size="lg">Confirm delivery</SubmitButton>
                        </ActionForm>
                      </Modal>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}
