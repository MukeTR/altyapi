"use client";

import { FileQuestion } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { MessageKey } from "@/lib/i18n/translate";

/** A record id the API answered 404 for (deleted, or in a store the user cannot see). */
export function RecordNotFound({ backPath, backLabel }: { backPath: string; backLabel: MessageKey }) {
  const { t } = useI18n();
  const { basePath } = useStore();
  return (
    <div className="mx-auto max-w-[960px] rounded-lg border border-border bg-surface">
      <EmptyState
        icon={FileQuestion}
        headingLevel={1}
        title={t("states.recordNotFoundTitle")}
        description={t("states.recordNotFoundBody")}
        actions={
          <ButtonLink href={`${basePath}${backPath}`} variant="primary">
            {t(backLabel)}
          </ButtonLink>
        }
      />
    </div>
  );
}
