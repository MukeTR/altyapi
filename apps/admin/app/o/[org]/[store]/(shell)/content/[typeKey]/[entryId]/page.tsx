import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntryEditor } from "@/components/content/entry-editor";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ContentTypeDetail, EntryDetail } from "@/lib/content/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; typeKey: string; entryId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store, entryId } = await params;
  const { t } = await getI18n();
  if (!UUID.test(entryId)) return { title: t("content.title") };
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const entry = await load<EntryDetail>(`${ctx.apiBase}/content/entries/${entryId}`);
  return { title: entry.ok ? entry.data.title || t("content.entries.untitled") : t("content.title") };
}

/** Content › entry editor. */
export default async function EntryPage({ params }: { params: Params }) {
  const { org, store, typeKey, entryId } = await params;
  if (!UUID.test(entryId)) notFound();
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  const entry = await load<EntryDetail>(`${ctx.apiBase}/content/entries/${entryId}`, { notFoundOn404: true });
  // The type comes from the entry (a link with another type key still opens the entry).
  const type = entry.ok ? await load<ContentTypeDetail>(`${ctx.apiBase}/content/types/${entry.data.type.id}`, { notFoundOn404: true }) : null;
  const failed = !entry.ok ? entry.error : type && !type.ok ? type.error : null;
  if (failed || !entry.ok || !type?.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("content.title")} breadcrumbs={[{ label: t("content.title"), href: `${ctx.basePath}/content` }, { label: typeKey, href: `${ctx.basePath}/content/${encodeURIComponent(typeKey)}` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={failed} />
        </div>
      </div>
    );
  }
  return <EntryEditor key={entry.data.entry.id} type={type.data} initial={entry.data} />;
}
