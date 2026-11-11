"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { useT } from "@/lib/i18n/client";

/** Validated categorical order (light surface) — assigned in fixed order, never cycled. */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const GRID = "#eceff3";
const AXIS = "#667085";

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

function fmtTick(v: unknown) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}.${v.slice(5, 7)}`;
  return String(v);
}

function fmtVal(v: unknown, unit?: string, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const n = Number(v);
  const a = Math.abs(n);
  const s =
    a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e8 ? `${Math.round(n / 1e6)}M` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("ru-RU", { maximumFractionDigits: digits });
  return unit ? `${s} ${unit}` : s;
}

function ChartTooltip({ active, payload, label, unit, digits }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit?: string; digits?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] shadow-lg">
      <div className="mb-1 font-medium text-ink">{fmtTick(label)}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="flex-1">{p.name}</span>
          <span className="tabular font-medium text-ink">{Number(p.value).toLocaleString("ru-RU", { maximumFractionDigits: digits ?? 1 })}{unit ? ` ${unit}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

export function BarChartView({
  data,
  xKey,
  series,
  stacked = false,
  height = 260,
  unit,
  horizontal = false,
  digits = 1,
  referenceY,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  stacked?: boolean;
  height?: number;
  unit?: string;
  horizontal?: boolean;
  digits?: number;
  referenceY?: { value: number; label: string };
}) {
  const t = useT();
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 8 : -8 }} barCategoryGap="22%">
          <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtVal(v)} />
              <YAxis type="category" dataKey={xKey} width={180} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: string) => (v.length > 30 ? v.slice(0, 29) + "…" : v)} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} tickFormatter={fmtTick} minTickGap={8} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtVal(v)} width={56} allowDecimals={digits > 0} />
            </>
          )}
          <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={<ChartTooltip unit={unit} digits={digits} />} />
          {series.length > 1 && <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, color: AXIS, paddingTop: 4 }} />}
          {referenceY && <ReferenceLine y={referenceY.value} stroke="#98a2b3" strokeDasharray="4 4" label={{ value: t(referenceY.label), fill: AXIS, fontSize: 11, position: "insideTopRight" }} />}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={t(s.label)}
              fill={s.color ?? SERIES[i % SERIES.length]}
              stackId={stacked ? "a" : undefined}
              radius={stacked ? (i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              stroke="#ffffff"
              strokeWidth={stacked ? 1 : 0}
              maxBarSize={horizontal ? 18 : 36}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineChartView({
  data,
  xKey,
  series,
  height = 260,
  unit,
  digits = 1,
  referenceY,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  unit?: string;
  digits?: number;
  referenceY?: { value: number; label: string };
}) {
  const t = useT();
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} tickFormatter={fmtTick} minTickGap={12} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtVal(v)} width={56} allowDecimals={digits > 0} />
          <Tooltip cursor={{ stroke: "#98a2b3", strokeWidth: 1 }} content={<ChartTooltip unit={unit} digits={digits} />} />
          {series.length > 1 && <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12, color: AXIS, paddingTop: 4 }} />}
          {referenceY && <ReferenceLine y={referenceY.value} stroke="#98a2b3" strokeDasharray="4 4" label={{ value: t(referenceY.label), fill: AXIS, fontSize: 11, position: "insideTopRight" }} />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={t(s.label)}
              stroke={s.color ?? SERIES[i % SERIES.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  const t = useT();
  return (
    <div style={{ height }} className="flex items-center justify-center rounded-lg border border-dashed border-line text-[13px] text-ink-3">
      {t("No data for the selected period")}
    </div>
  );
}

/**
 * Ranked dot plot for ratios that vary in a narrow band (e.g. yield 75–79%),
 * where zero-based bars would hide the differences. Axis range is shown explicitly.
 */
export function DotPlot({ data, unit = "%", digits = 2, secondaryLabel }: { data: { label: string; value: number; secondary?: number | null; href?: string }[]; unit?: string; digits?: number; secondaryLabel?: string }) {
  const t = useT();
  if (!data.length) return <EmptyChart height={160} />;
  const vals = data.map((d) => d.value);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const lo = Math.floor(Math.min(...vals) - 0.5);
  const hi = Math.ceil(Math.max(...vals) + 0.5);
  const x = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  return (
    <div>
      <div className="mb-1 ml-[42%] flex justify-between text-[11px] text-ink-3 sm:ml-[38%]">
        <span>{lo}{unit}</span>
        <span>{t("avg")} {avg.toFixed(digits)}{unit}</span>
        <span>{hi}{unit}</span>
      </div>
      <ul className="space-y-1.5">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-[12px]" title={`${d.label}: ${d.value.toFixed(digits)}${unit}`}>
            <span className="w-[42%] truncate text-ink-2 sm:w-[38%]">{d.label}</span>
            <span className="relative h-4 flex-1">
              <span className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
              <span className="absolute top-0 h-4 w-px bg-slate-300" style={{ left: `${x(avg)}%` }} />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#2a78d6] shadow-[0_0_0_1px_#2a78d6]" style={{ left: `${x(d.value)}%` }} />
            </span>
            <span className="w-16 text-right tabular font-medium text-ink">{d.value.toFixed(digits)}{unit}</span>
            {d.secondary !== undefined && d.secondary !== null && <span className="hidden w-20 text-right tabular text-ink-3 sm:inline">{secondaryLabel} {d.secondary.toFixed(1)}{unit}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
