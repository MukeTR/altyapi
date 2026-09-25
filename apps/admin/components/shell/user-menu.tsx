"use client";

import { Keyboard, Languages, LogOut, SunMoon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { logoutAction } from "@/app/actions/auth";
import { setThemeAction, setUiLocaleAction } from "@/app/actions/preferences";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyThemePreference, isThemePreference, type ThemePreference } from "@/lib/theme";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toLocaleUpperCase("tr");
}

export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const [theme, setTheme] = useState<ThemePreference>("system");
  useEffect(() => {
    const pref = document.documentElement.dataset.themePref;
    if (isThemePreference(pref)) setTheme(pref);
  }, []);
  const change = (pref: ThemePreference) => {
    setTheme(pref);
    applyThemePreference(pref);
    void setThemeAction(pref);
  };
  return [theme, change];
}

export function useUiLocaleSwitch() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (locale: string) =>
    startTransition(async () => {
      await setUiLocaleAction(locale);
      router.refresh();
    });
  return { change, pending };
}

export function UserMenu({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const { t, locale } = useI18n();
  const { user } = useStore();
  const [theme, setTheme] = useThemePreference();
  const { change: setLocale } = useUiLocaleSwitch();
  const [, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("shell.userMenu")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-subtle-fg hover:ring-2 hover:ring-border"
        >
          <span aria-hidden="true">{initials(user.name) || "?"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="flex flex-col px-2 pb-2 pt-1.5">
          <span className="truncate text-base font-medium text-fg">{user.name}</span>
          <span className="truncate text-sm text-fg-muted">{user.email}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden="true" />
            {t("shell.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={locale} onValueChange={setLocale}>
              <DropdownMenuRadioItem value="tr">Türkçe</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunMoon aria-hidden="true" />
            {t("shell.theme")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuLabel>{t("shell.theme")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => isThemePreference(v) && setTheme(v)}>
              <DropdownMenuRadioItem value="system">{t("shell.themeSystem")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">{t("shell.themeLight")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t("shell.themeDark")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={onOpenShortcuts}>
          <Keyboard aria-hidden="true" />
          {t("shell.shortcuts")}
          <span className="ms-auto text-xs text-fg-subtle">?</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => startTransition(() => logoutAction())}>
          <LogOut aria-hidden="true" />
          {t("shell.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
