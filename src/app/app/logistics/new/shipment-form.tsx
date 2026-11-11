"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, FormError, Hidden, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { cx } from "@/components/ui/basic";
import { createShipmentAction } from "../actions";

export function ShipmentForm({
  vehicles,
  drivers,
  routes,
  orders,
  preselect,
  defaultDeparture,
}: {
  vehicles: { id: string; label: string; type: string; capacity: number | null }[];
  drivers: { id: string; label: string; expired: boolean }[];
  routes: { id: string; label: string }[];
  orders: { id: string; label: string; sub: string; kg: number; frozenOnly: boolean }[];
  preselect?: string;
  defaultDeparture: string;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string[]>(preselect ? [preselect] : []);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const total = orders.filter((o) => selected.includes(o.id)).reduce((s, o) => s + o.kg, 0);
  const over = vehicle?.capacity ? total > vehicle.capacity : false;
  return (
    <ActionForm action={createShipmentAction} className="space-y-4">
      <Hidden name="orderIds" value={JSON.stringify(selected)} />
      <Hidden name="vehicleId" value={vehicleId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="label">{t("Vehicle")} *</span>
          <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <SelectInput name="driverId" label="Driver" required placeholder="" options={drivers.map((d) => ({ value: d.id, label: d.expired ? `${d.label} (${t("licence expired")})` : d.label }))} />
        <SelectInput name="routeId" label="Route" placeholder="—" options={routes.map((r) => ({ value: r.id, label: r.label }))} />
        <TextInput name="plannedDeparture" label="Planned departure" type="datetime-local" required defaultValue={defaultDeparture} />
        <SelectInput name="temperatureMode" label="Temperature mode" defaultValue="CHILLED" translateOptions options={[{ value: "CHILLED", label: "Chilled (0…+4 °C)" }, { value: "FROZEN", label: "Frozen (≤ −18 °C, freezer only)" }]} />
        <TextInput name="notes" label="Notes" />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">{t("Orders ready for dispatch")}</span>
          <span className={cx("tabular", over ? "font-semibold text-red-700" : "text-ink-2")}>
            {total.toFixed(0)} kg {vehicle?.capacity ? `/ ${vehicle.capacity} kg` : ""}
          </span>
        </div>
        <div className="max-h-[420px] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {orders.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.includes(o.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, o.id] : selected.filter((x) => x !== o.id))} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-[12px] text-ink-3">{o.sub}{o.frozenOnly ? ` · ${t("frozen")}` : ""}</span>
              </span>
              <span className="tabular text-sm">{o.kg.toFixed(1)} kg</span>
            </label>
          ))}
        </div>
      </div>
      {over && <p className="text-[12.5px] text-red-700">{t("Selected weight exceeds vehicle capacity — the shipment will be rejected.")}</p>}
      <FormError />
      <div className="flex justify-end"><SubmitButton>Create shipment</SubmitButton></div>
    </ActionForm>
  );
}
