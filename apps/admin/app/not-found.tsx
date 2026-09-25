import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getI18n } from "@/lib/i18n/server";
import { FileQuestion } from "lucide-react";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh items-center justify-center p-4">
      <title>{t("states.notFoundTitle")}</title>
      <EmptyState
        icon={FileQuestion}
        headingLevel={1}
        title={t("states.notFoundTitle")}
        description={t("states.notFoundBody")}
        actions={
          <ButtonLink href="/" variant="primary">
            {t("common.goHome")}
          </ButtonLink>
        }
      />
    </main>
  );
}
