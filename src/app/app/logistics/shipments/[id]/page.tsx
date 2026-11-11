import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtTemp, fmtTime } from "@/lib/format";
import { toLocalInput } from "@/lib/tz";
import { tempLimits } from "@/lib/settings";
import { Alert, Card, CardHeader, DataSourceBadge, DescriptionList, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SubmitButton, TextInput } from "@/components/ui/form";
import { LineChartView } from "@/components/charts";
import { cancelShipmentAction, confirmStopAction, departShipmentAction, recordTemperatureAction } from "../../actions";

export default async function ShipmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "logistics.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const sh = await tx.shipment.findUnique({
      where: { id },
      include: {
        vehicle: true,
        driver: true,
        route: true,
        readings: { orderBy: { recordedAt: "asc" } },
        stops: {
          orderBy: { sequence: "asc" },
          include: { order: { include: { customer: true, items: { include: { product: true, allocations: { where: { status: { in: ["PICKED", "SHIPPED"] } }, include: { inventory: { include: { batch: true } } } } } } } } },
        },
      },
    });
    if (!sh) return null;
    const wialon = await tx.integration.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: "wialon" } } });
    return { sh, wialon };
  });
  if (!data) notFound();
  const { sh } = data;
  const t = ctx.t;
  const can = ctx.can("logistics.operate");
  const lim = tempLimits(ctx.settings, sh.temperatureMode);
  const excursions = sh.readings.filter((r) => r.isExcursion);
  const batches = new Map<string, { id: string; code: string; kg: number }>();
  for (const s of sh.stops) for (const i of s.order.items) for (const a of i.allocations) {
    const e = batches.get(a.batchId) ?? { id: a.batchId, code: a.inventory.batch.code, kg: 0 };
    e.kg += a.quantityKg;
    batches.set(a.batchId, e);
  }
  const totalKg = sh.stops.reduce((s, st) => s + st.order.items.reduce((a, i) => a + i.pickedKg, 0), 0);
  const sources = new Set(sh.readings.map((r) => r.dataSource));
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Logistics & Fleet"), href: "/app/logistics" }, { label: sh.number }]}
        title={`${t("Shipment")} ${sh.number}`}
        description={`${sh.vehicle.plate} · ${sh.driver.name} · ${sh.route?.name ?? t("no route")}`}
        actions={
          <>
            <StatusBadge status={sh.status} />
            {can && (sh.status === "PLANNED" || sh.status === "LOADING") && (
              <ActionButton action={departShipmentAction} fields={{ id: sh.id }} variant="primary" size="md" confirm="Confirm departure?" confirmText="Stock of all picked lots is deducted and orders move to In Delivery." confirmVariant="primary">
                Depart
              </ActionButton>
            )}
            {ctx.can("logistics.manage") && (sh.status === "PLANNED" || sh.status === "LOADING") && (
              <ActionButton action={cancelShipmentAction} fields={{ id: sh.id }} size="md" variant="ghost" confirm="Cancel this shipment?">Cancel</ActionButton>
            )}
          </>
        }
      />
      {excursions.length > 0 && (
        <Alert tone="critical" className="mb-4" title={t("{n} temperature excursion(s) during this shipment", { n: excursions.length })}>
          {t("Allowed range")}: {lim.min ?? "—"} … {lim.max} °C. {t("Max recorded")}: {fmtTemp(Math.max(...excursions.map((e) => e.temperatureC)))}.
        </Alert>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Delivery stops")} description={`${sh.stops.length} ${t("stops")} · ${fmtKg(totalKg, 0)}`} />
            <div className="space-y-3">
              {sh.stops.map((s) => (
                <div key={s.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[12px] font-semibold text-white">{s.sequence}</span>
                    <Link href={`/app/orders/${s.orderId}`} className="link">{s.order.number}</Link>
                    <span className="text-sm">{s.order.customer.name}</span>
                    <span className="ml-auto"><StatusBadge status={s.status} /></span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-ink-3">{s.order.deliveryAddress} · {s.order.customer.phone}</div>
                  <div className="mt-1 text-[12.5px] text-ink-2">{s.order.items.map((i) => `${i.product.name} ${i.pickedKg.toFixed(1)} kg`).join(" · ")}</div>
                  {s.status !== "PENDING" && <div className="mt-1 text-[12.5px] text-ink-3">{t("Received by")} {s.receivedBy} · {fmtDateTime(s.deliveredAt, ctx.tz)}{s.notes ? ` · ${s.notes}` : ""}</div>}
                  {can && s.status === "PENDING" && sh.status === "IN_TRANSIT" && (
                    <div className="mt-2">
                      <Modal trigger={t("Confirm delivery")} title="Confirm delivery" triggerSize="sm" triggerVariant="primary" size="lg" description={`${s.order.number} · ${s.order.customer.name}`}>
                        <ActionForm action={confirmStopAction} className="space-y-3">
                          <Hidden name="shipmentId" value={sh.id} />
                          <Hidden name="orderId" value={s.orderId} />
                          <SimpleTable head={[t("Product"), t("Shipped"), t("Delivered kg")]}>
                            {s.order.items.map((i) => (
                              <tr key={i.id}>
                                <td className="td">{i.product.name}</td>
                                <td className="td tabular">{i.pickedKg.toFixed(3)}</td>
                                <td className="td"><input name={`d_${i.id}`} type="number" step="any" min={0} max={i.pickedKg} defaultValue={i.pickedKg.toFixed(3)} className="input h-8 w-28 py-1 text-right" /></td>
                              </tr>
                            ))}
                          </SimpleTable>
                          <TextInput name="receivedBy" label="Received by (name)" required />
                          <TextInput name="notes" label="Note (e.g. rejected items)" />
                          <FormError />
                          <div className="flex justify-end"><SubmitButton>Confirm</SubmitButton></div>
                        </ActionForm>
                      </Modal>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader
              title={t("Body temperature")}
              description={`${t("Allowed")} ${lim.min ?? "—"} … ${lim.max} °C · ${t("data source")}: ${[...sources].map((x) => t(x === "DEMO" ? "demo data" : x === "DEVICE" ? "device" : "manual")).join(", ") || "—"}`}
            />
            <LineChartView data={sh.readings.map((r) => ({ time: fmtTime(r.recordedAt, ctx.tz), temp: r.temperatureC }))} xKey="time" series={[{ key: "temp", label: "Temperature" }]} unit="°C" referenceY={{ value: lim.max, label: "max" }} height={220} />
            <SimpleTable head={[t("Time"), t("Temperature"), t("Source"), t("Status")]} className="mt-3">
              {sh.readings.slice(-12).reverse().map((r) => (
                <tr key={r.id}>
                  <td className="td">{fmtDateTime(r.recordedAt, ctx.tz)}</td>
                  <td className={`td tabular ${r.isExcursion ? "font-semibold text-red-700" : ""}`}>{fmtTemp(r.temperatureC)}</td>
                  <td className="td"><DataSourceBadge source={r.dataSource} t={t} /></td>
                  <td className="td">{r.isExcursion ? <Pill tone="red">{t("Excursion")}</Pill> : <Pill tone="green">OK</Pill>}</td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title={t("Shipment")} />
            <DescriptionList
              cols={1}
              items={[
                { label: t("Vehicle"), value: `${sh.vehicle.plate} · ${sh.vehicle.model ?? ""}` },
                { label: t("Driver"), value: `${sh.driver.name} · ${sh.driver.phone ?? ""}` },
                { label: t("Temperature mode"), value: t(sh.temperatureMode === "FROZEN" ? "Frozen" : "Chilled") },
                { label: t("Planned departure"), value: fmtDateTime(sh.plannedDeparture, ctx.tz) },
                { label: t("Departed"), value: fmtDateTime(sh.departedAt, ctx.tz) },
                { label: t("Arrived (last stop)"), value: fmtDateTime(sh.arrivedAt, ctx.tz) },
                { label: t("GPS / telematics"), value: data.wialon?.status === "CONNECTED" ? `Wialon · ${sh.vehicle.telematicsDeviceId ?? t("no device")}` : t("Not connected — readings are manual or demo data, not live tracking") },
              ]}
            />
          </Card>
          {can && sh.status !== "CANCELLED" && (
            <Card>
              <CardHeader title={t("Record temperature (manual)")} />
              <ActionForm action={recordTemperatureAction} className="space-y-3" resetOnSuccess>
                <Hidden name="sourceType" value="VEHICLE" />
                <Hidden name="shipmentId" value={sh.id} />
                <NumberInput name="temperatureC" label="Temperature" required suffix="°C" />
                <TextInput name="recordedAt" label="Time" type="datetime-local" required defaultValue={toLocalInput(new Date(), ctx.tz)} />
                <FormError />
                <SubmitButton className="w-full">Save reading</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card>
            <CardHeader title={t("Associated batches")} />
            <ul className="space-y-1.5 text-[13px]">
              {[...batches.values()].map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <Link href={`/app/traceability/${b.id}`} className="truncate font-mono text-[12px] text-navy-700 hover:underline">{b.code}</Link>
                  <span className="tabular text-ink-3">{fmtKg(b.kg, 1)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
