"use client";

import { Blocks } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown instead of a content screen while the store's content module is off. */
export function ContentModuleOff() {
  const { t } = useI18n();
  const { basePath, can } = useStore();
  return (
    <div className="rounded-lg border border-border bg-surface">
      <EmptyState
        icon={Blocks}
        title={t("content.moduleOff.title")}
        description={t("content.moduleOff.body")}
        actions={
          can("site:read") ? (
            <ButtonLink href={`${basePath}/site/modules`} variant="primary">
              {t("content.moduleOff.action")}
            </ButtonLink>
          ) : null
        }
      />
    </div>
  );
}
