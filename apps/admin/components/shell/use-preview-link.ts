"use client";

import { useTransition } from "react";
import { createPreviewLinkAction } from "@/app/actions/tenancy";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { useToast } from "@/components/ui/toast";

/**
 * Opens the storefront with drafts visible. The tab is opened synchronously on click (so popup
 * blockers allow it) and pointed at the preview URL once the token is minted.
 */
export function usePreviewLink() {
  const { t } = useI18n();
  const { organization, store } = useStore();
  const { toast, toastError } = useToast();
  const [pending, startTransition] = useTransition();

  const open = () => {
    const tab = window.open("about:blank", "_blank");
    startTransition(async () => {
      const result = await createPreviewLinkAction(organization.id, store.id, store.slug);
      if (!result.ok) {
        tab?.close();
        toastError(result.error);
        return;
      }
      if (tab) {
        tab.opener = null;
        tab.location.href = result.url;
      } else {
        toast({ tone: "info", title: t("shell.previewBlocked", { url: result.url }) });
      }
    });
  };

  return { open, pending };
}
