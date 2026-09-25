import { LOCALE_REGISTRY, localeDir, localeInfo, type LocaleInfo } from "@altyapi/commerce-core/locales";
import { intlLocale, type UiLocale } from "@/lib/i18n/config";

export { LOCALE_REGISTRY, localeDir, localeInfo, type LocaleInfo };

const displayNames = new Map<UiLocale, Intl.DisplayNames>();

/** Name of a content language in the interface language (tr: registry's Turkish name). */
export function localeLabel(code: string, uiLocale: UiLocale): string {
  const info = localeInfo(code);
  if (uiLocale === "tr" && info) return info.nameTr;
  let names = displayNames.get(uiLocale);
  if (!names) {
    names = new Intl.DisplayNames([intlLocale(uiLocale)], { type: "language" });
    displayNames.set(uiLocale, names);
  }
  return names.of(code) ?? info?.name ?? code;
}

/** html lang attribute for a content language. */
export function localeHtmlLang(code: string): string {
  return localeInfo(code)?.htmlLang ?? code;
}
