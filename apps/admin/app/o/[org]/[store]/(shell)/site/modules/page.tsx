import type { Metadata } from "next";
import { ModulesManager } from "@/components/site/modules-manager";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { SiteModule } from "@/lib/site/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("site.modules.title") };
}

/** Site › capability modules. */
export default async function SiteModulesPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const modules = await load<ItemList<SiteModule>>(`${ctx.apiBase}/site/modules`);
  if (!modules.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("site.modules.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={modules.error} />
        </div>
      </div>
    );
  }
  return <ModulesManager initial={modules.data.items} />;
}
