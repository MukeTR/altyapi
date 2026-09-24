import { invalid } from "./errors";

/**
 * Every language a store can publish in, in display order. Adding a code here (and its
 * registry entry below) makes it available to store settings, localized fields and the
 * storefront; existing {tr, en} data stays valid.
 */
export const LOCALE_CODES = ["tr", "en", "de", "ar", "ru", "fr", "fa", "az", "nl", "uk", "ka"] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];

export type TextDirection = "ltr" | "rtl";

export interface LocaleInfo {
  /** Locale code used in URLs, localized maps and store settings. */
  code: LocaleCode;
  /** Name in the language itself (language switchers). */
  name: string;
  /** Turkish name (admin panel). */
  nameTr: string;
  dir: TextDirection;
  /** Open Graph locale (language_TERRITORY). */
  ogLocale: string;
  /** BCP 47 tag for <html lang> and hreflang. */
  htmlLang: string;
}

// Keyed by code so the compiler rejects a code without an entry (and an entry without a code).
const ENTRIES: Record<LocaleCode, Omit<LocaleInfo, "code">> = {
  tr: { name: "Türkçe", nameTr: "Türkçe", dir: "ltr", ogLocale: "tr_TR", htmlLang: "tr" },
  en: { name: "English", nameTr: "İngilizce", dir: "ltr", ogLocale: "en_US", htmlLang: "en" },
  de: { name: "Deutsch", nameTr: "Almanca", dir: "ltr", ogLocale: "de_DE", htmlLang: "de" },
  ar: { name: "العربية", nameTr: "Arapça", dir: "rtl", ogLocale: "ar_AR", htmlLang: "ar" },
  ru: { name: "Русский", nameTr: "Rusça", dir: "ltr", ogLocale: "ru_RU", htmlLang: "ru" },
  fr: { name: "Français", nameTr: "Fransızca", dir: "ltr", ogLocale: "fr_FR", htmlLang: "fr" },
  fa: { name: "فارسی", nameTr: "Farsça", dir: "rtl", ogLocale: "fa_IR", htmlLang: "fa" },
  az: { name: "Azərbaycan dili", nameTr: "Azerbaycan Türkçesi", dir: "ltr", ogLocale: "az_AZ", htmlLang: "az" },
  nl: { name: "Nederlands", nameTr: "Felemenkçe", dir: "ltr", ogLocale: "nl_NL", htmlLang: "nl" },
  uk: { name: "Українська", nameTr: "Ukraynaca", dir: "ltr", ogLocale: "uk_UA", htmlLang: "uk" },
  ka: { name: "ქართული", nameTr: "Gürcüce", dir: "ltr", ogLocale: "ka_GE", htmlLang: "ka" },
};

export const LOCALE_REGISTRY: readonly LocaleInfo[] = LOCALE_CODES.map((code) => ({ code, ...ENTRIES[code] }));

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && Object.hasOwn(ENTRIES, value);
}

/** Registry entry for a code, or null for codes outside the registry. */
export function localeInfo(code: string): LocaleInfo | null {
  return isLocaleCode(code) ? { code, ...ENTRIES[code] } : null;
}

/** Text direction of a locale; codes outside the registry are treated as left-to-right. */
export function localeDir(code: string): TextDirection {
  return isLocaleCode(code) ? ENTRIES[code].dir : "ltr";
}

/**
 * Languages the storefront interface is fully translated into: storefront UI text and the
 * labels the route resolver writes into titles and breadcrumbs. Pages in other registry
 * languages show interface text in English, then Turkish (uiLocaleChain); store content
 * itself is always shown in the requested language.
 */
export const UI_LOCALE_CODES = ["tr", "en", "de", "ar", "ru", "fr"] as const satisfies readonly LocaleCode[];

export type UiLocaleCode = (typeof UI_LOCALE_CODES)[number];

const UI_FALLBACK_CHAIN: readonly UiLocaleCode[] = ["en", "tr"];

/** Interface languages to try for a page locale, most specific first. */
export function uiLocaleChain(locale: string): UiLocaleCode[] {
  const own = (UI_LOCALE_CODES as readonly string[]).includes(locale) ? [locale as UiLocaleCode] : [];
  return [...new Set([...own, ...UI_FALLBACK_CHAIN])];
}

/**
 * Rejects a localized value (`{ tr: "…", en: "…" }`) that carries text for a language the
 * store does not publish in. Keys without content (undefined, null, empty string) are
 * ignored so clearing a translation never fails validation.
 */
export function assertStoreLocales(value: Record<string, unknown>, supported: readonly string[], field?: string): void {
  for (const [locale, text] of Object.entries(value)) {
    if (text === undefined || text === null || text === "") continue;
    if (!isLocaleCode(locale)) throw invalid("errors.locale.unknown", { locale, ...(field ? { field } : {}) });
    if (!supported.includes(locale)) throw invalid("errors.locale.not_enabled", { locale, supported: [...supported], ...(field ? { field } : {}) });
  }
}
