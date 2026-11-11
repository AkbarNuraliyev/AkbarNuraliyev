import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { num } from "@/lib/format";
import { addDaysKey, localDateKey } from "@/lib/tz";
import { Card, PageHeader } from "@/components/ui/basic";
import { OrderBuilder } from "@/components/app/order-builder";
import { createOrderAction } from "../actions";

export default async function NewOrderPage() {
  const ctx = await requireApp({ permission: "orders.operate" });
  const data = await withTenant(ctx, async (tx) => {
    const [customers, products, items] = await Promise.all([
      tx.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      tx.product.findMany({ where: { isActive: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sku: "asc" }] }),
      tx.priceListItem.findMany(),
    ]);
    return { customers, products, items };
  });
  const prices: Record<string, Record<string, number>> = {};
  for (const i of data.items) (prices[i.priceListId] ??= {})[i.productId] = num(i.price);
  const today = localDateKey(new Date(), ctx.tz);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: ctx.t("B2B Orders"), href: "/app/orders" }, { label: ctx.t("New order") }]} title={ctx.t("New B2B order")} description={ctx.t("Contract prices are applied automatically from the customer's price list.")} />
      <Card>
        <OrderBuilder
          action={createOrderAction}
          customers={data.customers.map((c) => ({ id: c.id, name: c.name, priceListId: c.priceListId, address: c.deliveryAddress ?? c.address }))}
          products={data.products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, basePrice: num(p.price), net: p.isVariableWeight ? null : p.netWeightKg, storageType: p.storageType }))}
          prices={prices}
          minDate={today}
          defaultDate={addDaysKey(today, 1)}
        />
      </Card>
    </>
  );
}
