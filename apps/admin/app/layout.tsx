import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { InlineScript } from "@/components/inline-script";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { ThemeSync } from "@/components/providers/theme";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PREFERENCE_COOKIES } from "@/lib/cookies";
import { getI18n } from "@/lib/i18n/server";
import { THEME_BOOT_SCRIPT, isThemePreference } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "altyapi", template: "%s · altyapi" },
  // The admin is private: never indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, catalog, t } = await getI18n();
  const stored = (await cookies()).get(PREFERENCE_COOKIES.theme)?.value;
  const themePref = isThemePreference(stored) ? stored : "system";
  return (
    <html lang={locale} data-theme={themePref === "dark" ? "dark" : "light"} data-theme-pref={themePref} suppressHydrationWarning>
      <head>
        <InlineScript html={THEME_BOOT_SCRIPT} />
      </head>
      <body className="min-h-dvh bg-canvas text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-base focus:font-medium focus:text-fg focus:shadow-md"
        >
          {t("common.skipToContent")}
        </a>
        <I18nProvider catalog={catalog}>
          <TooltipProvider>
            <ToastProvider>{children}</ToastProvider>
          </TooltipProvider>
        </I18nProvider>
        <ThemeSync />
      </body>
    </html>
  );
}
