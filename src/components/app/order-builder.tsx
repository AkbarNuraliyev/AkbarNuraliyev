"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, Field, FormError, Hidden, SubmitButton, TextArea, TextInput, useFormState, type ServerAction } from "@/components/ui/form";

export interface BuilderProduct {
  id: string;
  sku: string;
  name: string;
  basePrice: number;
  net: number | null;
  storageType: string;
}

/** Shared order editor for the back office and the B2B portal. Prices shown are contract prices; the server re-prices on save. */
export function OrderBuilder({
  action,
  customers,
  products,
  prices,
  minDate,
  defaultDate,
  fixedCustomerId,
  submitLabel = "Create order",
}: {
  action: ServerAction;
  customers?: { id: string; name: string; priceListId: string | null; address: string | null }[];
  products: BuilderProduct[];
  prices: Record<string, Record<string, number>>; // priceListId → productId → price
  minDate: string;
  defaultDate: string;
  fixedCustomerId?: { id: string; priceListId: string | null };
  submitLabel?: string;
}) {
  const t = useT();
  const [customerId, setCustomerId] = useState(fixedCustomerId?.id ?? "");
  const [lines, setLines] = useState<{ productId: string; quantityKg: string }[]>([{ productId: "", quantityKg: "" }]);
  const customer = customers?.find((c) => c.id === customerId);
  const priceListId = fixedCustomerId ? fixedCustomerId.priceListId : customer?.priceListId ?? null;
  const priceOf = (pid: string) => (priceListId && prices[priceListId]?.[pid] !== undefined ? prices[priceListId][pid] : products.find((p) => p.id === pid)?.basePrice ?? 0);
  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantityKg) || 0) * priceOf(l.productId), 0), [lines, priceListId]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = lines.filter((l) => l.productId && Number(l.quantityKg) > 0).map((l) => ({ productId: l.productId, quantityKg: Number(l.quantityKg) }));

  return (
    <ActionForm action={action} className="space-y-4">
      <Hidden name="items" value={JSON.stringify(items)} />
      <div className="grid gap-4 sm:grid-cols-3">
        {customers && !fixedCustomerId && (
          <Field label="Customer" name="customerId" required className="sm:col-span-2">
            <select name="customerId" className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t("Select…")}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {fixedCustomerId && <Hidden name="customerId" value={fixedCustomerId.id} />}
        <TextInput name="requestedDeliveryDate" label="Delivery date" type="date" required min={minDate} defaultValue={defaultDate} />
      </div>
      {customers && <TextInput name="deliveryAddress" label="Delivery address" placeholder={customer?.address ?? ""} key={customerId} defaultValue={customer?.address ?? ""} />}
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">{t("Product")}</th>
              <th className="th w-32">{t("Quantity")}</th>
              <th className="th w-32 text-right">{t("Price")}</th>
              <th className="th w-36 text-right">{t("Line total")}</th>
              <th className="th w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => {
              const p = products.find((x) => x.id === l.productId);
              const price = l.productId ? priceOf(l.productId) : 0;
              return (
                <tr key={i}>
                  <td className="td">
                    <select className="input" value={l.productId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                      <option value="">{t("Select product…")}</option>
                      {products.map((pp) => (
                        <option key={pp.id} value={pp.id} disabled={lines.some((x, j) => j !== i && x.productId === pp.id)}>
                          {pp.sku} — {pp.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <div className="relative">
                      <input type="number" min={0} step={p?.net ?? 0.5} inputMode="decimal" className="input pr-9" value={l.quantityKg} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantityKg: e.target.value } : x)))} />
                      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12px] text-ink-3">{p?.net ? t("kg") : "kg"}</span>
                    </div>
                  </td>
                  <td className="td text-right tabular text-ink-2">{price ? price.toLocaleString("ru-RU") : "—"}</td>
                  <td className="td text-right tabular font-medium">{price && Number(l.quantityKg) ? Math.round(price * Number(l.quantityKg)).toLocaleString("ru-RU") : "—"}</td>
                  <td className="td">
                    {lines.length > 1 && (
                      <button type="button" className="text-ink-3 hover:text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={t("Remove")}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr>
              <td className="td" colSpan={3}>
                <button type="button" className="inline-flex items-center gap-1 text-[13px] font-medium text-navy-700 hover:underline" onClick={() => setLines([...lines, { productId: "", quantityKg: "" }])}>
                  <Plus className="h-4 w-4" /> {t("Add line")}
                </button>
              </td>
              <td className="td text-right tabular font-semibold">{Math.round(total).toLocaleString("ru-RU")} UZS</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <ItemsError />
      <p className="text-[12px] text-ink-3">{t("Variable-weight products are invoiced on the actually delivered weight. Prices are your contract prices.")}</p>
      <TextArea name="notes" label="Notes" rows={2} />
      {customers && <TextInput name="externalRef" label="Customer PO / external reference" />}
      <FormError />
      <div className="flex justify-end">
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function ItemsError() {
  const { state } = useFormState();
  const e = state?.errors?.items;
  return e ? <p className="text-[12.5px] text-red-600">{e}</p> : null;
}
