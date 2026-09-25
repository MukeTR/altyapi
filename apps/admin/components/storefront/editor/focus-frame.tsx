"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOptionalStore } from "@/components/providers/store-provider";
import { ButtonLink } from "@/components/ui/button";

/** Centered card for full-screen tools that could not start (errors, empty storefront), with a way back. */
export function FocusFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const store = useOptionalStore();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center border-b border-border bg-surface px-3">
        {store ? (
          <ButtonLink href={`${store.basePath}/storefront`} variant="ghost" size="sm">
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            {t("editor.backToPages")}
          </ButtonLink>
        ) : null}
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 py-12 outline-none">
        <div className="w-full max-w-[560px] rounded-lg border border-border bg-surface">{children}</div>
      </main>
    </div>
  );
}
