"use client";

import { useI18n } from "@/components/providers/i18n-provider";

/**
 * Merchant-facing text for a domain's failureReason: known platform reasons are translated,
 * anything else (an error message from the certificate provider) is shown as reported.
 */
export function useFailureReason() {
  const { t } = useI18n();
  return (reason: string) => t.maybe(`domains.failure.${reason}`) ?? t("domains.failure.other", { reason });
}
