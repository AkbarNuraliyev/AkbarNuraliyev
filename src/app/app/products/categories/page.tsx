import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { PageHeader, Pill } from "@/components/ui/basic";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormActions, FormError, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { createCategoryAction } from "../actions";
import { ProductTabs } from "../tabs";

export default async function CategoriesPage() {
  const ctx = await requireApp({ permission: "products.view" });
  const cats = await withTenant(ctx, (tx) => tx.productCategory.findMany({ include: { _count: { select: { products: true } } }, orderBy: { sortOrder: "asc" } }));
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Products & Labels")}
        description={t("Configurable product categories with default storage and shelf life.")}
        actions={
          ctx.can("products.manage") && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("New category")}</>} title="New category" triggerVariant="primary">
              <ActionForm action={createCategoryAction} className="space-y-4">
                <TextInput name="code" label="Code" required placeholder="MARINATED" />
                <TextInput name="name" label="Name" required />
                <SelectInput name="storageType" label="Storage" defaultValue="CHILLED" translateOptions options={[{ value: "CHILLED", label: "Chilled" }, { value: "FROZEN", label: "Frozen" }, { value: "AMBIENT", label: "Ambient" }]} />
                <NumberInput name="defaultShelfLifeHours" label="Default shelf life (hours)" step={1} />
                <NumberInput name="sortOrder" label="Sort order" step={1} />
                <FormError />
                <FormActions><SubmitButton>Create category</SubmitButton></FormActions>
              </ActionForm>
            </Modal>
          )
        }
      />
      <ProductTabs current="categories" t={t} />
      <SimpleTable head={[t("Code"), t("Category"), t("Storage"), t("Default shelf life"), t("Products")]}>
        {cats.map((c) => (
          <tr key={c.id}>
            <td className="td">{c.code}</td>
            <td className="td font-medium">{t(c.name)}</td>
            <td className="td"><Pill tone={c.storageType === "FROZEN" ? "blue" : "green"}>{t(c.storageType === "FROZEN" ? "Frozen" : c.storageType === "AMBIENT" ? "Ambient" : "Chilled")}</Pill></td>
            <td className="td tabular">{c.defaultShelfLifeHours ? `${c.defaultShelfLifeHours} h` : "—"}</td>
            <td className="td tabular">{c._count.products}</td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
