"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, Field, FormError, Hidden, NumberInput, SubmitButton, TextArea } from "@/components/ui/form";
import { recordB2BReturnAction } from "../actions";

export function ReturnForm({
  deliveries,
  warehouses,
}: {
  deliveries: { key: string; customerId: string; orderId: string; productId: string; batchId: string; label: string; max: number }[];
  warehouses: { id: string; name: string; chambers: { id: string; name: string; type: string }[] }[];
}) {
  const t = useT();
  const [sel, setSel] = useState(deliveries[0]?.key ?? "");
  const [action, setAction] = useState<"WRITE_OFF" | "RESTOCK">("WRITE_OFF");
  const d = deliveries.find((x) => x.key === sel);
  const quarantine = warehouses.flatMap((w) => w.chambers.filter((c) => c.type === "QUARANTINE").map((c) => ({ w, c })));
  return (
    <ActionForm action={recordB2BReturnAction} className="space-y-4">
      <Field label="Delivered line (order · customer · product · batch)" name="batchId" required>
        <select className="input" value={sel} onChange={(e) => setSel(e.target.value)}>
          {deliveries.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </Field>
      {d && (
        <>
          <Hidden name="customerId" value={d.customerId} />
          <Hidden name="orderId" value={d.orderId} />
          <Hidden name="productId" value={d.productId} />
          <Hidden name="batchId" value={d.batchId} />
        </>
      )}
      <NumberInput name="quantityKg" label="Returned quantity" required suffix="kg" max={d?.max} />
      <TextArea name="reason" label="Reason" required rows={2} />
      <Hidden name="action" value={action} />
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={action === "WRITE_OFF"} onChange={() => setAction("WRITE_OFF")} className="accent-brand-600" /> {t("Write-off (destroy)")}</label>
        <label className="flex items-center gap-2"><input type="radio" checked={action === "RESTOCK"} onChange={() => setAction("RESTOCK")} className="accent-brand-600" /> {t("Put in quarantine")}</label>
      </div>
      {action === "RESTOCK" && quarantine[0] && (
        <>
          <Hidden name="restockWarehouseId" value={quarantine[0].w.id} />
          <Hidden name="restockChamberId" value={quarantine[0].c.id} />
          <p className="text-[12.5px] text-ink-3">{t("Goods will be placed in")} {quarantine[0].w.name} / {quarantine[0].c.name} {t("with status QUARANTINE.")}</p>
        </>
      )}
      <FormError />
      <div className="flex justify-end"><SubmitButton>Record return</SubmitButton></div>
    </ActionForm>
  );
}
