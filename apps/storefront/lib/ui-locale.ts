import { UI_LOCALE_CODES, uiLocaleChain, type UiLocaleCode } from "@altyapi/commerce-core/locales";

/**
 * Storefront UI languages with a complete translation, shared with the route resolver's
 * server-side labels (commerce-core locale registry). Other registry languages
 * (az, nl, uk, ka, fa) render the interface in English, then Turkish; store content
 * itself is always shown in the requested language.
 *
 * Free of dictionaries so client components can use it without pulling in text they do
 * not render.
 */
export const UI_LOCALES = UI_LOCALE_CODES;

export type UiLocale = UiLocaleCode;

/** One complete dictionary per UI language; the compiler rejects a missing key. */
export type UiDictionaries<T> = Record<UiLocale, T>;

/** UI languages to try for a page locale, most specific first. */
export function uiLocales(locale: string): UiLocale[] {
  return uiLocaleChain(locale);
}

/** The dictionary for a page locale, falling back to English, then Turkish. */
export function pickDictionary<T>(dictionaries: UiDictionaries<T>, locale: string): T {
  return dictionaries[uiLocales(locale)[0]!];
}

/** Replaces `{name}` placeholders with values. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars ?? {})) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}
