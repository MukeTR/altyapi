"use client";

import { ListTree } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function MenuNotFound() {
  const { t } = useI18n();
  const { basePath } = useStore();
  return (
    <div className="mx-auto max-w-[960px] rounded-lg border border-border bg-surface">
      <EmptyState
        icon={ListTree}
        headingLevel={1}
        title={t("storefront.menus.notFoundTitle")}
        description={t("storefront.menus.notFoundBody")}
        actions={
          <ButtonLink href={`${basePath}/storefront/navigation`} variant="primary">
            {t("storefront.menus.title")}
          </ButtonLink>
        }
      />
    </div>
  );
}
