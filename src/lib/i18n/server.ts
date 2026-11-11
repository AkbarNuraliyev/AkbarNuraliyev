import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { Locale } from "../format";
import { makeT, normalizeLocale } from "./index";

export const LOCALE_COOKIE = "pos_locale";

export const getLocale = cache(async (): Promise<Locale> => {
  const c = await cookies();
  const fromCookie = normalizeLocale(c.get(LOCALE_COOKIE)?.value);
  if (fromCookie) return fromCookie;
  const h = await headers();
  const al = (h.get("accept-language") ?? "").toLowerCase();
  if (al.startsWith("ru")) return "ru";
  if (al.startsWith("uz")) return "uz";
  return "en";
});

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: makeT(locale) };
}
