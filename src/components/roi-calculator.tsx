"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Info } from "lucide-react";

const DEFAULTS = {
  dailyKg: 20000,
  workingDays: 300,
  chilledShare: 70,
  writeOffPct: 3,
  writeOffReduction: 40,
  returnRate: 1.5,
  returnReduction: 30,
  currentYield: 76,
  yieldImprovement: 0.5,
  pricePerKg: 35000,
  paymentDelay: 21,
  delayReduction: 5,
  costOfCapital: 22,
};

type Inputs = typeof DEFAULTS;

const FIELDS: { key: keyof Inputs; label: string; unit: string; step: number; hint?: string }[] = [
  { key: "dailyKg", label: "Daily production volume", unit: "kg", step: 500, hint: "20 t/day is an illustrative assumption, not a verified figure." },
  { key: "workingDays", label: "Working days per year", unit: "days", step: 1 },
  { key: "chilledShare", label: "Chilled product share", unit: "%", step: 1 },
  { key: "writeOffPct", label: "Current write-off percentage (chilled)", unit: "%", step: 0.1 },
  { key: "writeOffReduction", label: "Expected reduction in write-offs", unit: "%", step: 1 },
  { key: "returnRate", label: "Customer return rate", unit: "%", step: 0.1 },
  { key: "returnReduction", label: "Expected reduction in returns", unit: "%", step: 1 },
  { key: "currentYield", label: "Current production yield", unit: "%", step: 0.1 },
  { key: "yieldImprovement", label: "Expected yield improvement", unit: "p.p.", step: 0.1 },
  { key: "pricePerKg", label: "Average sales price per kg", unit: "UZS", step: 500 },
  { key: "paymentDelay", label: "Average payment delay", unit: "days", step: 1 },
  { key: "delayReduction", label: "Payment delay reduction from faster documents", unit: "days", step: 1 },
  { key: "costOfCapital", label: "Cost of capital (annual)", unit: "%", step: 0.5 },
];

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");

export function RoiCalculator() {
  const t = useT();
  const [v, setV] = useState<Inputs>(DEFAULTS);
  const r = useMemo(() => {
    const annualKg = v.dailyKg * v.workingDays;
    const revenue = annualKg * v.pricePerKg;
    const writeOff = annualKg * (v.chilledShare / 100) * (v.writeOffPct / 100) * (v.writeOffReduction / 100) * v.pricePerKg;
    const returns = annualKg * (v.returnRate / 100) * (v.returnReduction / 100) * v.pricePerKg;
    const liveInput = v.currentYield > 0 ? annualKg / (v.currentYield / 100) : 0;
    const extraKg = liveInput * (v.yieldImprovement / 100);
    const yieldValue = extraKg * v.pricePerKg;
    const days = Math.min(v.delayReduction, v.paymentDelay);
    const workingCapital = (revenue / 365) * days;
    const financing = workingCapital * (v.costOfCapital / 100);
    const total = writeOff + returns + yieldValue + financing;
    return { annualKg, revenue, writeOff, returns, extraKg, yieldValue, workingCapital, financing, total };
  }, [v]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <div className="card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="label">{t(f.label)}</span>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  className="input pr-14"
                  step={f.step}
                  min={0}
                  value={Number.isFinite(v[f.key]) ? v[f.key] : ""}
                  onChange={(e) => setV({ ...v, [f.key]: Math.max(0, Number(e.target.value)) })}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-ink-3">{t(f.unit)}</span>
              </div>
              {f.hint && <span className="mt-1 block text-[11.5px] text-ink-3">{t(f.hint)}</span>}
            </label>
          ))}
        </div>
        <button type="button" className="mt-4 text-[13px] font-medium text-navy-700 hover:underline" onClick={() => setV(DEFAULTS)}>
          {t("Reset to illustrative defaults")}
        </button>
      </div>
      <div className="space-y-4">
        <div className="card bg-navy-900 p-5 text-white">
          <div className="text-[13px] text-navy-200">{t("Estimated total annual financial impact")}</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight tabular">{fmt(r.total)} UZS</div>
          <div className="mt-1 text-[12px] text-navy-300">
            ≈ {fmt(r.total / 12)} UZS / {t("month")} · {r.revenue ? ((r.total / r.revenue) * 100).toFixed(2) : "0"}% {t("of revenue")}
          </div>
        </div>
        <div className="card divide-y divide-line">
          {[
            { label: "Annual sales volume", value: `${fmt(r.annualKg / 1000)} t`, sub: `${fmt(r.revenue)} UZS ${t("revenue")}` },
            { label: "Write-off savings", value: `${fmt(r.writeOff)} UZS` },
            { label: "Customer return savings", value: `${fmt(r.returns)} UZS` },
            { label: "Additional production value (yield)", value: `${fmt(r.yieldValue)} UZS`, sub: `+${fmt(r.extraKg / 1000)} t ${t("saleable output from the same live weight")}` },
            { label: "Working capital released (one-time)", value: `${fmt(r.workingCapital)} UZS`, sub: t("Not included in the annual total") },
            { label: "Annual financing cost saved on released capital", value: `${fmt(r.financing)} UZS` },
          ].map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-[13px] text-ink-2">{t(row.label)}</div>
                {row.sub && <div className="text-[11.5px] text-ink-3">{row.sub}</div>}
              </div>
              <div className="text-right text-sm font-semibold tabular text-ink">{row.value}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("All results are estimates based on the inputs above, not guaranteed savings. Actual results depend on your processes, data quality and adoption.")}</span>
        </div>
      </div>
    </div>
  );
}
