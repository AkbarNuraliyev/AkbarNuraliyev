import type { Farm, Supplier } from "@prisma/client";
import { ActionForm, Checkbox, FormActions, FormError, FormGrid, Hidden, NumberInput, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { num } from "@/lib/format";
import { createFarmAction, createSupplierAction, updateFarmAction, updateSupplierAction } from "./actions";

const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : undefined);

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  return (
    <ActionForm action={supplier ? updateSupplierAction : createSupplierAction} className="space-y-4">
      {supplier && <Hidden name="id" value={supplier.id} />}
      <FormGrid cols={3}>
        <TextInput name="code" label="Supplier code" required defaultValue={supplier?.code} placeholder="SUP21" />
        <TextInput name="name" label="Legal name" required defaultValue={supplier?.name} className="sm:col-span-2" />
        <SelectInput name="type" label="Type" defaultValue={supplier?.type ?? "FARM"} translateOptions options={[{ value: "FARM", label: "Farm" }, { value: "INTEGRATOR", label: "Integrator" }, { value: "TRADER", label: "Trader" }]} />
        <TextInput name="taxId" label="TIN" defaultValue={supplier?.taxId} />
        <TextInput name="region" label="Region" defaultValue={supplier?.region} />
        <TextInput name="contactName" label="Contact person" defaultValue={supplier?.contactName} />
        <TextInput name="phone" label="Phone" type="tel" defaultValue={supplier?.phone} />
        <TextInput name="email" label="Email" type="email" defaultValue={supplier?.email} />
      </FormGrid>
      <TextInput name="address" label="Address" defaultValue={supplier?.address} />
      <FormGrid cols={3}>
        <TextInput name="contractNumber" label="Contract number" defaultValue={supplier?.contractNumber} />
        <TextInput name="contractStart" label="Contract start" type="date" defaultValue={d(supplier?.contractStart)} />
        <TextInput name="contractEnd" label="Contract end" type="date" defaultValue={d(supplier?.contractEnd)} />
        <NumberInput name="paymentTermsDays" label="Payment terms (days)" defaultValue={supplier?.paymentTermsDays} min={0} step={1} />
        <NumberInput name="pricePerKgLive" label="Contract price per kg live weight" defaultValue={supplier?.pricePerKgLive ? num(supplier.pricePerKgLive) : undefined} suffix="UZS" />
      </FormGrid>
      <TextArea name="notes" label="Notes" defaultValue={supplier?.notes} />
      {supplier && <Checkbox name="isActive" label="Active supplier" defaultChecked={supplier.isActive} />}
      <FormError />
      <FormActions>
        <SubmitButton>{supplier ? "Save changes" : "Create supplier"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

export function FarmForm({ farm, suppliers, supplierId }: { farm?: Farm; suppliers: { id: string; name: string; code: string }[]; supplierId?: string }) {
  return (
    <ActionForm action={farm ? updateFarmAction : createFarmAction} className="space-y-4">
      {farm && <Hidden name="id" value={farm.id} />}
      <SelectInput name="supplierId" label="Supplier" required placeholder="" defaultValue={farm?.supplierId ?? supplierId} options={suppliers.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} />
      <FormGrid cols={3}>
        <TextInput name="code" label="Farm code" required defaultValue={farm?.code} placeholder="FARM053" hint="Used in batch IDs" />
        <TextInput name="name" label="Farm name" required defaultValue={farm?.name} className="sm:col-span-2" />
        <TextInput name="region" label="Region" defaultValue={farm?.region} />
        <TextInput name="district" label="District" defaultValue={farm?.district} />
        <TextInput name="breed" label="Breed" defaultValue={farm?.breed} placeholder="Ross 308" />
        <NumberInput name="capacityBirds" label="Capacity (birds)" defaultValue={farm?.capacityBirds} step={1} min={0} />
        <TextInput name="vetRegistration" label="Veterinary registration" defaultValue={farm?.vetRegistration} />
      </FormGrid>
      <TextInput name="address" label="Address" defaultValue={farm?.address} />
      <FormGrid>
        <NumberInput name="latitude" label="Latitude" defaultValue={farm?.latitude} />
        <NumberInput name="longitude" label="Longitude" defaultValue={farm?.longitude} />
      </FormGrid>
      {farm && <Checkbox name="isActive" label="Active farm" defaultChecked={farm.isActive} />}
      <FormError />
      <FormActions>
        <SubmitButton>{farm ? "Save changes" : "Create farm"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
