"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "./button";
import { InlineAlert } from "./inline-alert";

export interface ConflictBannerProps {
  /** Discard local edits and load the server's current version. */
  onReload: () => void;
  /** Save again on top of the newer version (sends the current revision). */
  onOverwrite?: () => void;
  pending?: boolean;
}

/** Shown on 409 optimistic-concurrency conflicts (errors.content.revision_conflict and similar). */
export function ConflictBanner({ onReload, onOverwrite, pending }: ConflictBannerProps) {
  const { t } = useI18n();
  return (
    <InlineAlert
      tone="warning"
      live="alert"
      title={t("states.conflictTitle")}
      actions={
        <>
          <Button size="sm" onClick={onReload} disabled={pending}>
            {t("states.conflictReload")}
          </Button>
          {onOverwrite ? (
            <Button size="sm" variant="ghost" onClick={onOverwrite} loading={pending ?? false}>
              {t("states.conflictOverwrite")}
            </Button>
          ) : null}
        </>
      }
    >
      {t("states.conflictBody")}
    </InlineAlert>
  );
}
