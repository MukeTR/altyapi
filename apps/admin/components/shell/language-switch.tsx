"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setUiLocaleAction } from "@/app/actions/preferences";
import { useI18n } from "@/components/providers/i18n-provider";
import { SegmentedControl } from "@/components/ui/radio-group";

/** TR / EN switch for pages outside the shell (sign-in, sign-up, onboarding). */
export function LanguageSwitch() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <SegmentedControl
      size="sm"
      aria-label={t("shell.language")}
      value={locale}
      onValueChange={(next) =>
        startTransition(async () => {
          await setUiLocaleAction(next);
          router.refresh();
        })
      }
      options={[
        { value: "tr", label: "TR", "aria-label": "Türkçe" },
        { value: "en", label: "EN", "aria-label": "English" },
      ]}
    />
  );
}
