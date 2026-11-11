import type { Locale } from "../format";
import { ru } from "./ru";
import { uz } from "./uz";

export type Dict = Record<string, string>;
export type TFunc = (key: string, params?: Record<string, string | number>) => string;

export const LOCALES: { code: Locale; label: string; short: string }[] = [
  { code: "ru", label: "Русский", short: "RU" },
  { code: "uz", label: "O‘zbekcha", short: "UZ" },
  { code: "en", label: "English", short: "EN" },
];

export const DICTS: Record<Locale, Dict> = { en: {}, ru, uz };

export function normalizeLocale(v: string | undefined | null): Locale | null {
  if (v === "en" || v === "ru" || v === "uz") return v;
  return null;
}

export function translate(dict: Dict, key: string, params?: Record<string, string | number>): string {
  let s = dict[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function makeT(locale: Locale): TFunc {
  const dict = DICTS[locale] ?? {};
  return (key, params) => translate(dict, key, params);
}
