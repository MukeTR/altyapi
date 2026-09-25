/** Languages the admin interface is translated into. Store content languages are separate (store.supportedLocales). */
export const UI_LOCALES = ["tr", "en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "tr";

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

/** BCP 47 tag used for Intl formatting of numbers, money and dates. */
export function intlLocale(locale: UiLocale): string {
  return locale === "tr" ? "tr-TR" : "en-US";
}
