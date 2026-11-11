import Link from "@/components/ui/link";
import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtMoney, num } from "@/lib/format";
import { Card, PageHeader, cx } from "@/components/ui/basic";
import { spGet, type SP } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormActions, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { createPriceListAction, savePricesAction } from "../actions";
import { SalesTabs } from "../forms";

export default async function PriceListsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "sales.view" });
  const sp = await searchParams;
  const data = await withTenant(ctx, async (tx) => {
    const lists = await tx.priceList.findMany({ include: { _count: { select: { customers: true, items: true } } }, orderBy: { name: "asc" } });
    const current = lists.find((l) => l.id === spGet(sp, "list")) ?? lists[0];
    const [products, items] = await Promise.all([
      tx.product.findMany({ where: { isActive: true }, include: { category: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sku: "asc" }] }),
      current ? tx.priceListItem.findMany({ where: { priceListId: current.id } }) : [],
    ]);
    return { lists, current, products, items };
  });
  const t = ctx.t;
  const canManage = ctx.can("sales.manage");
  const priceOf = new Map(data.items.map((i) => [i.productId, num(i.price)]));
  return (
    <>
      <PageHeader
        title={t("Sales & Customers")}
        description={t("Contract price lists. Customers see and order at the prices of their assigned list; products not in the list are hidden from their portal catalog.")}
        actions={
          canManage && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("New price list")}</>} title="New price list" triggerVariant="primary">
              <ActionForm action={createPriceListAction} className="space-y-4">
                <TextInput name="name" label="Name" required />
                <SelectInput name="copyFromId" label="Copy prices from" placeholder="Product base prices" options={data.lists.map((l) => ({ value: l.id, label: l.name }))} />
                <NumberInput name="factor" label="Price factor" defaultValue={1} step={0.01} hint="e.g. 0.95 = 5% discount" />
                <FormError />
                <FormActions><SubmitButton>Create</SubmitButton></FormActions>
              </ActionForm>
            </Modal>
          )
        }
      />
      <SalesTabs current="prices" t={t} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {data.lists.map((l) => (
              <li key={l.id}>
                <Link href={`/app/sales/price-lists?list=${l.id}`} className={cx("block px-4 py-3 hover:bg-slate-50", data.current?.id === l.id && "bg-slate-50")}>
                  <div className="text-sm font-medium">{l.name}</div>
                  <div className="text-[12px] text-ink-3">{t("{n} customers", { n: l._count.customers })} · {t("{n} products", { n: l._count.items })}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        {data.current && (
          <ActionForm action={savePricesAction}>
            <Hidden name="priceListId" value={data.current.id} />
            <div className="card overflow-x-auto">
              <table className="min-w-full divide-y divide-line">
                <thead className="bg-slate-50/70">
                  <tr>{[t("SKU"), t("Product"), t("Category"), t("Base price"), t("Contract price"), t("Difference")].map((h) => <th key={h} className="th">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.products.map((p) => {
                    const cp = priceOf.get(p.id);
                    const diff = cp !== undefined ? ((cp - num(p.price)) / num(p.price)) * 100 : null;
                    return (
                      <tr key={p.id}>
                        <td className="td">{p.sku}</td>
                        <td className="td">{p.name}</td>
                        <td className="td text-ink-3">{t(p.category.name)}</td>
                        <td className="td tabular">{fmtMoney(p.price)}</td>
                        <td className="td">
                          {canManage ? <input name={`price_${p.id}`} type="number" min={0} step={100} defaultValue={cp ?? ""} placeholder={t("not listed")} className="input h-8 w-32 py-1 text-right" /> : cp !== undefined ? fmtMoney(cp) : "—"}
                        </td>
                        <td className="td tabular text-[12.5px]">{diff === null ? <span className="text-ink-3">{t("hidden")}</span> : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canManage && (
              <div className="mt-3 flex justify-end gap-2">
                <FormError />
                <SubmitButton>Save prices</SubmitButton>
              </div>
            )}
          </ActionForm>
        )}
      </div>
    </>
  );
}
