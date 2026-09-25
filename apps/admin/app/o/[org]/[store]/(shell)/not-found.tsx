"use client";

import { FileQuestion } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Unknown screen or record id inside a store (API 404s on records render this too). */
export default function ShellNotFound() {
  const { t } = useI18n();
  const { basePath } = useStore();
  return (
    <div className="mx-auto max-w-[960px] rounded-lg border border-border bg-surface">
      <EmptyState
        icon={FileQuestion}
        headingLevel={1}
        title={t("states.notFoundTitle")}
        description={t("states.notFoundBody")}
        actions={
          <ButtonLink href={basePath} variant="primary">
            {t("nav.overview")}
          </ButtonLink>
        }
      />
    </div>
  );
}
