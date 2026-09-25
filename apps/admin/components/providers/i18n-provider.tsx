"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { describeApiError, type DescribedError } from "@/lib/api/describe";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { Catalog } from "@/lib/i18n/catalog";
import type { UiLocale } from "@/lib/i18n/config";
import { createTranslator, type Translator } from "@/lib/i18n/translate";

interface I18nValue {
  locale: UiLocale;
  catalog: Catalog;
  t: Translator;
  /** Localized message, per-field messages and support code for an API error. */
  describeError: (error: ApiErrorInfo, fieldForKey?: Record<string, string>) => DescribedError;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ catalog, children }: { catalog: Catalog; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale: catalog.locale,
      catalog,
      t: createTranslator(catalog.messages),
      describeError: (error, fieldForKey) => describeApiError(error, catalog, fieldForKey),
    }),
    [catalog],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
