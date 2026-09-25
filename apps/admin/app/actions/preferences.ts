"use server";

import { cookies } from "next/headers";
import { PREFERENCE_COOKIES, PREFERENCE_MAX_AGE } from "@/lib/cookies";
import { serverEnv } from "@/lib/env";
import { isUiLocale } from "@/lib/i18n/config";
import { isThemePreference } from "@/lib/theme";

async function setPreference(name: string, value: string): Promise<void> {
  (await cookies()).set(name, value, { path: "/", sameSite: "lax", maxAge: PREFERENCE_MAX_AGE, secure: serverEnv.secureCookies() });
}

/** Interface language (tr | en); the caller refreshes the route to re-render with it. */
export async function setUiLocaleAction(locale: string): Promise<void> {
  if (isUiLocale(locale)) await setPreference(PREFERENCE_COOKIES.locale, locale);
}

/** Theme (system | light | dark); the client applies it immediately, the cookie keeps it for SSR. */
export async function setThemeAction(theme: string): Promise<void> {
  if (isThemePreference(theme)) await setPreference(PREFERENCE_COOKIES.theme, theme);
}

export async function setSidebarCollapsedAction(collapsed: boolean): Promise<void> {
  await setPreference(PREFERENCE_COOKIES.sidebar, collapsed ? "1" : "0");
}
