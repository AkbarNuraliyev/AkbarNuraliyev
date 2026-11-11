"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "../format";
import { DICTS, translate, type TFunc } from "./index";

const I18nContext = createContext<{ locale: Locale; t: TFunc }>({ locale: "en", t: (k) => k });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => {
    const dict = DICTS[locale] ?? {};
    return { locale, t: ((key, params) => translate(dict, key, params)) as TFunc };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext).t;
}

export function useLocale() {
  return useContext(I18nContext).locale;
}
