import type { Metadata } from "next";
import { EntryEditor } from "@/components/content/entry-editor";
import { ContentModuleOff } from "@/components/content/module-off";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import { labelText } from "@/lib/content/fields";
import type { ContentTypeDetail } from "@/lib/content/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; typeKey: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store, typeKey } = await params;
  const { t, locale } = await getI18n();
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const type = await load<ContentTypeDetail>(`${ctx.apiBase}/content/types/${encodeURIComponent(typeKey)}`);
  return { title: type.ok ? t("content.entries.new", { name: labelText(type.data.labels.name, locale, type.data.key) }) : t("content.title") };
}

/** Content › new entry: the editor creates the draft on the first autosave. */
export default async function NewEntryPage({ params }: { params: Params }) {
  const { org, store, typeKey } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  if (ctx.store.modules && !ctx.store.modules.includes("content")) return <ContentModuleOff />;
  const type = await load<ContentTypeDetail>(`${ctx.apiBase}/content/types/${encodeURIComponent(typeKey)}`, { notFoundOn404: true });
  if (!type.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("content.title")} breadcrumbs={[{ label: t("content.title"), href: `${ctx.basePath}/content` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={type.error} />
        </div>
      </div>
    );
  }
  return <EntryEditor type={type.data} initial={null} />;
}
