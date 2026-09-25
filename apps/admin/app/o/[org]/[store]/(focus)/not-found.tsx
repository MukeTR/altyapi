"use client";

import { FileQuestion } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { FocusFrame } from "@/components/storefront/editor/focus-frame";
import { EmptyState } from "@/components/ui/empty-state";

export default function FocusNotFound() {
  const { t } = useI18n();
  return (
    <FocusFrame>
      <EmptyState icon={FileQuestion} headingLevel={1} title={t("states.notFoundTitle")} description={t("states.notFoundBody")} />
    </FocusFrame>
  );
}
