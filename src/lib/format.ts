import { localParts } from "./tz";

export type Locale = "en" | "ru" | "uz";

const numLocale = (l: Locale) => (l === "en" ? "en-US" : l === "ru" ? "ru-RU" : "uz-Latn-UZ");

const pad = (n: number) => String(n).padStart(2, "0");

export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  if (typeof v === "object" && v !== null && "toNumber" in v) return (v as { toNumber(): number }).toNumber();
  return Number(v) || 0;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function group(n: number, digits: number): string {
  const fixed = Math.abs(n).toFixed(digits);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 && Number(fixed) !== 0 ? "−" : "") + grouped + (frac ? "," + frac : "");
}

/** Number with space grouping and comma decimals (ru/uz business convention). */
export function fmtNum(v: unknown, digits = 0): string {
  return group(num(v), digits);
}

export function fmtKg(v: unknown, digits = 1): string {
  return `${group(num(v), digits)} kg`;
}

/** Shows tonnes when the value is >= 1000 kg. */
export function fmtWeight(v: unknown): string {
  const n = num(v);
  if (Math.abs(n) >= 1000) return `${group(n / 1000, 2)} t`;
  return fmtKg(n, 1);
}

export function fmtMoney(v: unknown, currency = "UZS"): string {
  const n = num(v);
  return `${group(n, currency === "UZS" ? 0 : 2)} ${currency === "UZS" ? "UZS" : currency}`;
}

export function fmtMoneyShort(v: unknown, currency = "UZS"): string {
  const n = num(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${group(n / 1e9, 2)} bn ${currency}`;
  if (abs >= 1e6) return `${group(n / 1e6, 1)} M ${currency}`;
  return fmtMoney(n, currency);
}

export function fmtPct(v: unknown, digits = 1): string {
  const n = num(v);
  if (!Number.isFinite(n)) return "—";
  return `${group(n, digits)}%`;
}

export function fmtTemp(v: unknown): string {
  const n = num(v);
  return `${n > 0 ? "+" : ""}${group(n, 1)} °C`;
}

/** DD.MM.YYYY in tenant time zone. */
export function fmtDate(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const p = localParts(date, tz);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

/** Date-only DB values (stored as UTC midnight) — no tz shift. */
export function fmtDay(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

export function fmtDateTime(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const p = localParts(date, tz);
  return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function fmtTime(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const p = localParts(date, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function hoursUntil(d: Date, now: Date): number {
  return (d.getTime() - now.getTime()) / 3600000;
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}

export function numberLocale(l: Locale) {
  return numLocale(l);
}
