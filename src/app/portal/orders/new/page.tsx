import { requirePortal } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { num } from "@/lib/format";
import { addDaysKey, localDateKey } from "@/lib/tz";
import { Card, EmptyState, PageHeader } from "@/components/ui/basic";
import { OrderBuilder } from "@/components/app/order-builder";
import { createPortalOrderAction } from "../../actions";

export default async function PortalNewOrder() {
  const ctx = await requirePortal();
  const data = await withTenant(ctx, async (tx) => {
    const c = await tx.customer.findUniqueOrThrow({ where: { id: ctx.customerId } });
    const items = c.priceListId ? await tx.priceListItem.findMany({ where: { priceListId: c.priceListId, product: { isActive: true } }, include: { product: true }, orderBy: { product: { name: "asc" } } }) : [];
    return { c, items };
  });
  const t = ctx.t;
  const tomorrow = addDaysKey(localDateKey(new Date(), ctx.tz), 1);
  const prices: Record<string, Record<string, number>> = {};
  if (data.c.priceListId) prices[data.c.priceListId] = Object.fromEntries(data.items.map((i) => [i.productId, num(i.price)]));
  return (
    <>
      <PageHeader title={t("New order")} description={`${t("Delivery to")}: ${data.c.deliveryAddress ?? data.c.address ?? "—"}`} />
      {data.items.length === 0 ? (
        <EmptyState title={t("No catalog assigned yet")} description={t("Contact your account manager.")} />
      ) : (
        <Card>
          <OrderBuilder
            action={createPortalOrderAction}
            products={data.items.map((i) => ({ id: i.productId, sku: i.product.sku, name: i.product.name, basePrice: num(i.price), net: i.product.isVariableWeight ? null : i.product.netWeightKg, storageType: i.product.storageType }))}
            prices={prices}
            fixedCustomerId={{ id: data.c.id, priceListId: data.c.priceListId }}
            minDate={tomorrow}
            defaultDate={tomorrow}
            submitLabel="Submit order"
          />
        </Card>
      )}
    </>
  );
}
