"use client";

import { useState } from "react";
import { PREFERENCE_COOKIES } from "@/lib/cookies";
import { getCatalog } from "@/lib/i18n/catalog";
import { isUiLocale, type UiLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import "./globals.css";

function cookieLocale(): UiLocale {
  if (typeof document === "undefined") return "tr";
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${PREFERENCE_COOKIES.locale}=`));
  const value = match?.slice(PREFERENCE_COOKIES.locale.length + 1);
  return isUiLocale(value) ? value : "tr";
}

/** Replaces the root layout when it fails, so it renders its own document without providers. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [locale] = useState(cookieLocale);
  const t = createTranslator(getCatalog(locale).messages);
  return (
    <html lang={locale}>
      <body className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-fg">
        <title>{t("states.errorTitle")}</title>
        <main className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-xl font-semibold">{t("states.errorTitle")}</h1>
          <p className="text-base text-fg-muted">{t("states.unexpected")}</p>
          <button type="button" onClick={() => retry()} className="h-8 rounded-md bg-accent px-3 text-base font-medium text-accent-fg hover:bg-accent-hover">
            {t("common.retry")}
          </button>
          {error.digest ? (
            <p className="text-sm text-fg-subtle">
              {t("common.supportCode")}: <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
