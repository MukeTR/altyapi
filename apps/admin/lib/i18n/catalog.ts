import { apiErrorCodesEn, apiErrorsEn } from "./api-errors/en";
import { apiErrorCodesTr, apiErrorsTr } from "./api-errors/tr";
import type { UiLocale } from "./config";
import { en } from "./messages/en";
import { tr, type Messages } from "./messages/tr";

/** Everything the interface needs to render text in one language; passed once to the client provider. */
export interface Catalog {
  locale: UiLocale;
  messages: Messages;
  /** API `message_key` → text. */
  apiErrors: Record<string, string>;
  /** API error `code` → fallback text. */
  apiErrorCodes: Record<string, string>;
}

const CATALOGS: Record<UiLocale, Catalog> = {
  tr: { locale: "tr", messages: tr, apiErrors: apiErrorsTr, apiErrorCodes: apiErrorCodesTr },
  en: { locale: "en", messages: en, apiErrors: apiErrorsEn, apiErrorCodes: apiErrorCodesEn },
};

export function getCatalog(locale: UiLocale): Catalog {
  return CATALOGS[locale];
}
