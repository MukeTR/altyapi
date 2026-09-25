"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";
import { logoutAction } from "@/app/actions/auth";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={() => startTransition(() => logoutAction())}>
      <LogOut aria-hidden="true" />
      {t("shell.logout")}
    </Button>
  );
}
