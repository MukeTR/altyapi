import type { Metadata } from "next";
import { ContentTypesView } from "@/components/content/content-types-view";
import { ContentModuleOff } from "@/components/content/module-off";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { BuiltinTypeInfo, ContentTypeSummary } from "@/lib/content/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("content.title") };
}

/** Content: installed, installable and custom content types. */
export default async function ContentPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const header = <PageHeader title={t("content.title")} meta={t("content.description")} />;
  if (ctx.store.modules && !ctx.store.modules.includes("content")) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        {header}
        <ContentModuleOff />
      </div>
    );
  }
  const [types, available] = await Promise.all([
    load<ItemList<ContentTypeSummary>>(`${ctx.apiBase}/content/types`, { query: { includeArchived: true } }),
    load<ItemList<BuiltinTypeInfo>>(`${ctx.apiBase}/content/types/available`),
  ]);
  const failed = !types.ok ? types.error : !available.ok ? available.error : null;
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      {header}
      {failed || !types.ok || !available.ok ? (
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={failed} />
        </div>
      ) : (
        <ContentTypesView types={types.data.items} available={available.data.items} />
      )}
    </div>
  );
}
