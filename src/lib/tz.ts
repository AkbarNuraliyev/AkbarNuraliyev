/**
 * Time-zone helpers. All timestamps are stored in UTC; business days are
 * computed in the tenant's IANA time zone (default Asia/Tashkent).
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = partsFormatter(tz).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Offset of tz relative to UTC at the given instant, in minutes. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 'YYYY-MM-DD' of the instant in the tenant time zone. */
export function localDateKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** UTC instant of local midnight for a 'YYYY-MM-DD' key in tz. */
export function zonedMidnight(key: string, tz: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const off = tzOffsetMinutes(guess, tz);
  const result = new Date(guess.getTime() - off * 60000);
  const off2 = tzOffsetMinutes(result, tz);
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60000);
}

/** UTC instant for a local 'YYYY-MM-DDTHH:mm' value in tz. */
export function zonedDateTime(local: string, tz: string): Date {
  const [datePart, timePart = "00:00"] = local.split("T");
  const [hh, mm] = timePart.split(":").map(Number);
  const midnight = zonedMidnight(datePart, tz);
  return new Date(midnight.getTime() + (hh * 60 + (mm || 0)) * 60000);
}

export function startOfLocalDay(date: Date, tz: string): Date {
  return zonedMidnight(localDateKey(date, tz), tz);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3600000);
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Date-only columns (@db.Date) are stored as UTC midnight of the local date key. */
export function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dateOnlyKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Day of week (0=Sunday) for a 'YYYY-MM-DD' key. */
export function weekdayOfKey(key: string): number {
  return dateOnly(key).getUTCDay();
}

/** Value for <input type="datetime-local"> in tz. */
export function toLocalInput(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function daysBetweenKeys(a: string, b: string): number {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400000);
}
