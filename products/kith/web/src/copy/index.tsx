import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { en } from "./en";
import { zhTW } from "./zh-TW";

export type Locale = "zh-TW" | "en";
export type CopyKey = keyof typeof zhTW;
export type CopyVars = Record<string, string | number>;

export const LOCALE_STORAGE_KEY = "kith.locale";

const TABLES: Record<Locale, Record<CopyKey, string>> = { "zh-TW": zhTW, en };

export function detectLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v === "zh-TW" || v === "en") return v;
  } catch {
    // localStorage unavailable (privacy mode): fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

export function translate(locale: Locale, key: CopyKey, vars?: CopyVars): string {
  return TABLES[locale][key].replace(/\{([a-zA-Z0-9]+)\}/g, (whole, name: string) =>
    vars !== undefined && name in vars ? String(vars[name]) : whole,
  );
}

type LocaleContextValue = { locale: Locale; setLocale: (next: Locale) => void };

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider(props: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies to this page.
    }
    document.documentElement.lang = next;
    setLocaleState(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider");
  return ctx;
}

export function useT(): (key: CopyKey, vars?: CopyVars) => string {
  const { locale } = useLocale();
  return useCallback((key: CopyKey, vars?: CopyVars) => translate(locale, key, vars), [locale]);
}
