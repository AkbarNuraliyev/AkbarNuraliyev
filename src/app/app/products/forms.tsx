import type { Product } from "@prisma/client";
import { ActionForm, Checkbox, FormActions, FormError, FormGrid, Hidden, NumberInput, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { num } from "@/lib/format";
import { createProductAction, updateProductAction } from "./actions";

export function ProductForm({ product, categories }: { product?: Product; categories: { id: string; name: string }[] }) {
  return (
    <ActionForm action={product ? updateProductAction : createProductAction} className="space-y-4">
      {product && <Hidden name="id" value={product.id} />}
      <FormGrid cols={3}>
        <TextInput name="sku" label="SKU" required defaultValue={product?.sku} placeholder="CH-BRF" />
        <TextInput name="name" label="Product name" required defaultValue={product?.name} className="sm:col-span-2" />
        <SelectInput name="categoryId" label="Category" required placeholder="" defaultValue={product?.categoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} translateOptions />
        <SelectInput name="storageType" label="Storage" defaultValue={product?.storageType ?? "CHILLED"} translateOptions options={[{ value: "CHILLED", label: "Chilled" }, { value: "FROZEN", label: "Frozen" }, { value: "AMBIENT", label: "Ambient" }]} />
        <NumberInput name="shelfLifeHours" label="Shelf life (hours)" required step={1} defaultValue={product?.shelfLifeHours ?? 72} hint="72 h chilled; 4320 h = 180 days frozen" />
      </FormGrid>
      <FormGrid cols={4}>
        <NumberInput name="storageTempMin" label="Min storage °C" defaultValue={product?.storageTempMin ?? 0} />
        <NumberInput name="storageTempMax" label="Max storage °C" defaultValue={product?.storageTempMax ?? 4} />
        <NumberInput name="price" label="Selling price (per kg / pack)" required defaultValue={product ? num(product.price) : undefined} suffix="UZS" />
        <NumberInput name="costPerKg" label="Cost per kg" defaultValue={product?.costPerKg ? num(product.costPerKg) : undefined} suffix="UZS" hint="Used for inventory valuation" />
      </FormGrid>
      <TextInput name="storageInstructions" label="Storage instructions (printed on label)" defaultValue={product?.storageInstructions} placeholder="Store at 0…+4 °C" />
      <FormGrid cols={4}>
        <NumberInput name="netWeightKg" label="Net weight (fixed-weight packs)" defaultValue={product?.netWeightKg} suffix="kg" />
        <TextInput name="pluCode" label="PLU (5 digits)" defaultValue={product?.pluCode} hint="Used in variable-weight barcodes" />
        <TextInput name="barcode" label="EAN-13 barcode" defaultValue={product?.barcode} hint="Fixed-weight packs" />
        <NumberInput name="minStockKg" label="Minimum stock" defaultValue={product?.minStockKg} suffix="kg" />
        <NumberInput name="targetYieldPct" label="Target yield (% of live weight)" defaultValue={product?.targetYieldPct} suffix="%" />
      </FormGrid>
      <div className="grid gap-2 sm:grid-cols-3">
        <Checkbox name="isVariableWeight" label="Variable-weight product" defaultChecked={product?.isVariableWeight ?? true} />
        <Checkbox name="batchTracking" label="Batch tracking" defaultChecked={product?.batchTracking ?? true} />
        <Checkbox name="isByproduct" label="By-product / offal" defaultChecked={product?.isByproduct ?? false} />
        {product && <Checkbox name="isActive" label="Active" defaultChecked={product.isActive} />}
      </div>
      <TextArea name="description" label="Description" defaultValue={product?.description} rows={2} />
      <TextArea name="ingredients" label="Ingredients / composition" defaultValue={product?.ingredients} rows={2} />
      <FormError />
      <FormActions>
        <SubmitButton>{product ? "Save changes" : "Create product"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
