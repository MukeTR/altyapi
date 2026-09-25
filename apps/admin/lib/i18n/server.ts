import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { PREFERENCE_COOKIES } from "@/lib/cookies";
import { getCatalog, type Catalog } from "./catalog";
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "./config";
import { createTranslator, type Translator } from "./translate";

/** Interface language of the current request: the `admin_locale` cookie, else Turkish. */
export const getUiLocale = cache(async (): Promise<UiLocale> => {
  const value = (await cookies()).get(PREFERENCE_COOKIES.locale)?.value;
  return isUiLocale(value) ? value : DEFAULT_UI_LOCALE;
});

export interface ServerI18n {
  locale: UiLocale;
  catalog: Catalog;
  t: Translator;
}

export const getI18n = cache(async (): Promise<ServerI18n> => {
  const locale = await getUiLocale();
  const catalog = getCatalog(locale);
  return { locale, catalog, t: createTranslator(catalog.messages) };
});
