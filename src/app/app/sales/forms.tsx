import type { Customer } from "@prisma/client";
import { ActionForm, Checkbox, FormActions, FormError, FormGrid, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { Tabs } from "@/components/ui/basic";
import { num } from "@/lib/format";
import type { TFunc } from "@/lib/i18n";
import { createCustomerAction, updateCustomerAction } from "./actions";

export const CUSTOMER_TYPES = [
  { value: "HORECA", label: "HoReCa" },
  { value: "RETAIL_CHAIN", label: "Retail chain" },
  { value: "DISTRIBUTOR", label: "Distributor" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "OTHER", label: "Other" },
];

export function customerTypeLabel(t: TFunc, type: string) {
  return t(CUSTOMER_TYPES.find((c) => c.value === type)?.label ?? type);
}

export function CustomerForm({ customer, priceLists }: { customer?: Customer; priceLists: { id: string; name: string }[] }) {
  return (
    <ActionForm action={customer ? updateCustomerAction : createCustomerAction} className="space-y-4">
      {customer && <Hidden name="id" value={customer.id} />}
      <FormGrid cols={3}>
        <TextInput name="code" label="Customer code" required defaultValue={customer?.code} placeholder="C022" />
        <TextInput name="name" label="Name" required defaultValue={customer?.name} className="sm:col-span-2" />
        <SelectInput name="type" label="Customer type" defaultValue={customer?.type ?? "HORECA"} options={CUSTOMER_TYPES} translateOptions />
        <TextInput name="taxId" label="TIN" defaultValue={customer?.taxId} />
        <TextInput name="region" label="Region" defaultValue={customer?.region} />
        <TextInput name="contactName" label="Contact person" defaultValue={customer?.contactName} />
        <TextInput name="phone" label="Phone" type="tel" defaultValue={customer?.phone} />
        <TextInput name="email" label="Email" type="email" defaultValue={customer?.email} />
      </FormGrid>
      <TextInput name="address" label="Legal address" defaultValue={customer?.address} />
      <TextInput name="deliveryAddress" label="Delivery address" defaultValue={customer?.deliveryAddress} />
      <FormGrid cols={3}>
        <SelectInput name="priceListId" label="Contract price list" placeholder="Base prices" defaultValue={customer?.priceListId} options={priceLists.map((p) => ({ value: p.id, label: p.name }))} />
        <NumberInput name="paymentTermsDays" label="Payment terms (days)" required step={1} defaultValue={customer?.paymentTermsDays ?? 14} />
        <NumberInput name="creditLimit" label="Credit limit" suffix="UZS" defaultValue={customer?.creditLimit ? num(customer.creditLimit) : undefined} />
      </FormGrid>
      {customer && <Checkbox name="isActive" label="Active customer" defaultChecked={customer.isActive} />}
      <FormError />
      <FormActions>
        <SubmitButton>{customer ? "Save changes" : "Create customer"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

export function SalesTabs({ current, t }: { current: string; t: TFunc }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "customers", href: "/app/sales", label: t("Customers") },
        { key: "prices", href: "/app/sales/price-lists", label: t("Price lists") },
        { key: "receivables", href: "/app/sales/receivables", label: t("Receivables") },
        { key: "returns", href: "/app/sales/returns", label: t("Returns") },
      ]}
    />
  );
}
