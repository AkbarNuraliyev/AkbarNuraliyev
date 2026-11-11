"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, Field, FormError, Hidden, SubmitButton, TextInput } from "@/components/ui/form";
import { createTransferAction } from "../actions";

interface Lot {
  id: string;
  warehouseId: string;
  product: string;
  storageType: string;
  batch: string;
  free: number;
  expiry: string;
}

export function TransferForm({ warehouses, lots }: { warehouses: { id: string; name: string; type: string; chambers: { id: string; name: string; type: string }[] }[]; lots: Lot[] }) {
  const t = useT();
  const [from, setFrom] = useState(warehouses.find((w) => w.type !== "RETAIL")?.id ?? warehouses[0]?.id ?? "");
  const [to, setTo] = useState(warehouses.find((w) => w.id !== from)?.id ?? "");
  const [chamber, setChamber] = useState("");
  const [lines, setLines] = useState<{ inventoryId: string; quantityKg: number }[]>([]);
  const [pick, setPick] = useState("");
  const available = useMemo(() => lots.filter((l) => l.warehouseId === from && !lines.some((x) => x.inventoryId === l.id)), [lots, from, lines]);
  const dest = warehouses.find((w) => w.id === to);
  const lotOf = (id: string) => lots.find((l) => l.id === id);
  return (
    <ActionForm action={createTransferAction} className="space-y-4">
      <Hidden name="lines" value={JSON.stringify(lines)} />
      <Hidden name="toWarehouseId" value={to} />
      <Hidden name="toChamberId" value={chamber} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From" name="from">
          <select className="input" value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="To" name="toWarehouseId" required>
          <select className="input" value={to} onChange={(e) => { setTo(e.target.value); setChamber(""); }}>
            <option value="">{t("Select…")}</option>
            {warehouses.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Destination chamber" name="toChamberId">
          <select className="input" value={chamber} onChange={(e) => setChamber(e.target.value)}>
            <option value="">{t("Auto / none")}</option>
            {(dest?.chambers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex gap-2">
        <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{t("Add lot (earliest expiry first)…")}</option>
          {available.map((l) => (
            <option key={l.id} value={l.id}>
              {l.product} · {l.batch} · {l.free.toFixed(1)} kg · {t("exp.")} {l.expiry.slice(0, 10)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="h-9 shrink-0 rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-slate-50"
          onClick={() => {
            const l = lotOf(pick);
            if (l) setLines([...lines, { inventoryId: l.id, quantityKg: Math.round(l.free * 1000) / 1000 }]);
            setPick("");
          }}
        >
          {t("Add")}
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-slate-50"><tr><th className="th">{t("Product / batch")}</th><th className="th">{t("Free")}</th><th className="th">{t("Transfer kg")}</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {lines.map((ln, i) => {
              const l = lotOf(ln.inventoryId)!;
              return (
                <tr key={ln.inventoryId}>
                  <td className="td">{l.product}<div className="font-mono text-[11.5px] text-ink-3">{l.batch}</div></td>
                  <td className="td tabular">{l.free.toFixed(2)}</td>
                  <td className="td">
                    <input type="number" step="any" min={0} max={l.free} className="input h-8 w-28" value={ln.quantityKg} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantityKg: Number(e.target.value) } : x)))} />
                  </td>
                  <td className="td text-right">
                    <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-ink-3 hover:text-red-600" aria-label={t("Remove")}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={4} className="td text-center text-ink-3">{t("No lines added")}</td></tr>}
          </tbody>
        </table>
      </div>
      <TextInput name="notes" label="Notes" />
      <FormError />
      <div className="flex justify-end">
        <SubmitButton>Complete transfer</SubmitButton>
      </div>
    </ActionForm>
  );
}
