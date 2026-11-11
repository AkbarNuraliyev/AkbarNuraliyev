import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { createVehicleAction } from "../actions";
import { LogisticsTabs } from "../tabs";

export default async function VehiclesPage() {
  const ctx = await requireApp({ permission: "logistics.view" });
  const data = await withTenant(ctx, async (tx) => {
    const vehicles = await tx.vehicle.findMany({ include: { _count: { select: { shipments: true } } }, orderBy: { plate: "asc" } });
    const wialon = await tx.integration.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: "wialon" } } });
    return { vehicles, wialon };
  });
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Logistics & Fleet")}
        description={t("Vehicle registry with refrigeration type, capacity and telematics device mapping (Wialon-compatible trackers).")}
        actions={
          ctx.can("logistics.manage") && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("Vehicle")}</>} title="New vehicle" triggerVariant="primary">
              <ActionForm action={createVehicleAction} className="space-y-3">
                <TextInput name="plate" label="Plate number" required placeholder="01 A 123 AA" />
                <TextInput name="model" label="Model" />
                <SelectInput name="type" label="Body type" defaultValue="REFRIGERATED" translateOptions options={[{ value: "REFRIGERATED", label: "Refrigerated (0…+4 °C)" }, { value: "FREEZER", label: "Freezer (≤ −18 °C)" }, { value: "VAN", label: "Insulated van" }]} />
                <NumberInput name="capacityKg" label="Payload capacity" suffix="kg" />
                <SelectInput name="telematicsProvider" label="Telematics provider" placeholder="None" options={[{ value: "wialon", label: "Wialon" }]} />
                <TextInput name="telematicsDeviceId" label="Telematics unit ID" />
                <FormError />
                <div className="flex justify-end"><SubmitButton>Add vehicle</SubmitButton></div>
              </ActionForm>
            </Modal>
          )
        }
      />
      <LogisticsTabs current="vehicles" t={t} />
      <p className="mb-3 text-[12.5px] text-ink-3">{t("Wialon integration status")}: <StatusBadge status={data.wialon?.status ?? "NOT_CONNECTED"} /></p>
      <SimpleTable head={[t("Plate"), t("Model"), t("Type"), t("Capacity"), t("Telematics"), t("Shipments"), t("Status")]}>
        {data.vehicles.map((v) => (
          <tr key={v.id}>
            <td className="td font-medium">{v.plate}</td>
            <td className="td">{v.model}</td>
            <td className="td"><Pill tone={v.type === "FREEZER" ? "blue" : "green"}>{t(v.type === "FREEZER" ? "Freezer" : v.type === "VAN" ? "Van" : "Refrigerated")}</Pill></td>
            <td className="td tabular">{v.capacityKg ? `${fmtNum(v.capacityKg)} kg` : "—"}</td>
            <td className="td text-[12.5px]">{v.telematicsDeviceId ? `${v.telematicsProvider ?? ""} · ${v.telematicsDeviceId}` : "—"}</td>
            <td className="td tabular">{v._count.shipments}</td>
            <td className="td"><StatusBadge status={v.isActive ? "ACTIVE" : "INACTIVE"} /></td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
