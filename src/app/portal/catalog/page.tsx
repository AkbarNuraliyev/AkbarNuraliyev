import { requirePortal } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { EmptyState, PageHeader, Pill } from "@/components/ui/basic";
import { SimpleTable } from "@/components/ui/table";

export default async function PortalCatalog() {
  const ctx = await requirePortal();
  const items = await withTenant(ctx, async (tx) => {
    const c = await tx.customer.findUniqueOrThrow({ where: { id: ctx.customerId } });
    if (!c.priceListId) return [];
    return tx.priceListItem.findMany({ where: { priceListId: c.priceListId, product: { isActive: true } }, include: { product: { include: { category: true } } }, orderBy: [{ product: { category: { sortOrder: "asc" } } }, { product: { name: "asc" } }] });
  });
  const t = ctx.t;
  return (
    <>
      <PageHeader title={t("Catalog & contract prices")} description={t("Products assigned to your account with your contract prices (UZS, per kg for variable-weight products).")} />
      {items.length === 0 ? (
        <EmptyState title={t("No catalog assigned yet")} description={t("Contact your account manager.")} />
      ) : (
        <SimpleTable head={[t("Product"), t("Category"), t("Storage"), t("Shelf life"), t("Pack"), t("Your price")]}>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="td"><div className="font-medium">{i.product.name}</div><div className="text-[11.5px] text-ink-3">{i.product.sku}</div></td>
              <td className="td">{t(i.product.category.name)}</td>
              <td className="td"><Pill tone={i.product.storageType === "FROZEN" ? "blue" : "green"}>{t(i.product.storageType === "FROZEN" ? "Frozen" : "Chilled")}</Pill></td>
              <td className="td">{i.product.shelfLifeHours >= 720 ? `${Math.round(i.product.shelfLifeHours / 24)} ${t("days")}` : `${i.product.shelfLifeHours} h`}</td>
              <td className="td">{i.product.isVariableWeight ? t("Variable weight") : `${i.product.netWeightKg} kg`}</td>
              <td className="td tabular font-semibold">{fmtMoney(i.price)}{i.product.isVariableWeight ? " / kg" : ""}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </>
  );
}
