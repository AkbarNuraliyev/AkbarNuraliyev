"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, Field, FormError, Hidden, NumberInput, SubmitButton } from "@/components/ui/form";
import { cx } from "@/components/ui/basic";
import { addOutputAction } from "../../actions";

interface Props {
  shiftId: string;
  batches: { id: string; code: string; inputKg: number; outputKg: number }[];
  products: { id: string; sku: string; name: string; storageType: string; isByproduct: boolean; isVariableWeight: boolean; netWeightKg: number | null }[];
  warehouses: { id: string; name: string; chambers: { id: string; name: string; type: string }[] }[];
  wasteCategories: string[];
}

export function OutputForm(p: Props) {
  const t = useT();
  const [type, setType] = useState<"PRODUCT" | "BYPRODUCT" | "WASTE">("PRODUCT");
  const [batchId, setBatchId] = useState(p.batches[p.batches.length - 1]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState(p.warehouses[0]?.id ?? "");
  const [weight, setWeight] = useState("");
  const products = useMemo(() => p.products.filter((x) => (type === "BYPRODUCT" ? x.isByproduct : !x.isByproduct)), [p.products, type]);
  const product = p.products.find((x) => x.id === productId);
  const wh = p.warehouses.find((w) => w.id === warehouseId);
  const chambers = (wh?.chambers ?? []).filter((c) => (product?.storageType === "FROZEN" ? c.type === "FROZEN" : c.type !== "FROZEN"));
  const batch = p.batches.find((b) => b.id === batchId);
  const remaining = batch ? batch.inputKg - batch.outputKg : 0;
  const w = Number(weight || 0);
  const over = batch && w > remaining + 0.0005;

  return (
    <ActionForm action={addOutputAction} resetOnSuccess className="space-y-4">
      <Hidden name="shiftId" value={p.shiftId} />
      <Hidden name="outputType" value={type} />
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {(["PRODUCT", "BYPRODUCT", "WASTE"] as const).map((x) => (
          <button key={x} type="button" onClick={() => { setType(x); setProductId(""); }} className={cx("rounded-md py-2 text-sm font-medium", type === x ? "bg-white shadow-sm" : "text-ink-3")}>
            {t(x === "PRODUCT" ? "Product" : x === "BYPRODUCT" ? "By-product" : "Waste")}
          </button>
        ))}
      </div>
      <Field label="Input batch" name="batchId" required>
        <select name="batchId" className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {p.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} — {t("remaining")} {(b.inputKg - b.outputKg).toFixed(1)} kg
            </option>
          ))}
        </select>
      </Field>
      {type !== "WASTE" ? (
        <>
          <Field label={type === "BYPRODUCT" ? "By-product" : "Product"} name="productId" required>
            <select name="productId" className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t("Select…")}</option>
              {products.map((x) => (
                <option key={x.id} value={x.id}>{`${x.sku} — ${x.name}`}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Warehouse" name="warehouseId" required>
              <select name="warehouseId" className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {p.warehouses.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Storage chamber" name="chamberId">
              <select name="chamberId" className="input" key={`${warehouseId}-${product?.storageType}`}>
                {chambers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          </div>
        </>
      ) : (
        <Field label="Waste category" name="wasteCategory" required>
          <select name="wasteCategory" className="input">
            {p.wasteCategories.map((c) => (
              <option key={c} value={c}>{t(c)}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Net weight" name="weightKg" required className="col-span-3 sm:col-span-1">
          <div className="relative">
            <input name="weightKg" type="number" inputMode="decimal" step="any" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} className={cx("input pr-10 text-base font-semibold", over && "input-error")} />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-ink-3">kg</span>
          </div>
        </Field>
        {type !== "WASTE" && (
          <>
            <NumberInput name="units" label={product && !product.isVariableWeight ? "Units (packs)" : "Pieces / trays"} step={1} min={0} />
            <NumberInput name="packages" label="Cartons" step={1} min={0} />
          </>
        )}
      </div>
      {product && !product.isVariableWeight && product.netWeightKg && <p className="text-[12px] text-ink-3">{t("Fixed net weight")}: {product.netWeightKg} kg / {t("pack")}</p>}
      {over && <p className="rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-800">{t("Outputs would exceed the input weight of this batch in this shift — this entry will be rejected.")}</p>}
      <FormError />
      <SubmitButton className="w-full" size="lg">Record output</SubmitButton>
    </ActionForm>
  );
}
