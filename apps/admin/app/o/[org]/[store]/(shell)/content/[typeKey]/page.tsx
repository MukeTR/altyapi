import type { Metadata } from "next";
import { Plus, Settings2 } from "lucide-react";
import { EntriesView } from "@/components/content/entries-view";
import { ContentModuleOff } from "@/components/content/module-off";
import { ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { CursorPage, ItemList } from "@/lib/api/types";
import { oneOf, param } from "@/lib/commerce/query";
import { labelText, typeIndexPath } from "@/lib/content/fields";
import { ENTRY_STATUSES, type ContentTypeDetail, type ContentTypeSummary, type EntryListItem } from "@/lib/content/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; typeKey: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store, typeKey } = await params;
  const { t, locale } = await getI18n();
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const type = await load<ContentTypeDetail>(`${ctx.apiBase}/content/types/${encodeURIComponent(typeKey)}`);
  return { title: type.ok ? labelText(type.data.labels.namePlural, locale, type.data.key) : t("content.title") };
}

/** Content › entries of one type. */
export default async function EntriesPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { org, store, typeKey } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const sp = await searchParams;
  const { t, locale } = await getI18n();
  if (ctx.store.modules && !ctx.store.modules.includes("content")) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <PageHeader title={t("content.title")} />
        <ContentModuleOff />
      </div>
    );
  }
  const filters = { q: param(sp, "q"), status: oneOf(param(sp, "status"), ENTRY_STATUSES) };
  const [type, list, entries] = await Promise.all([
    load<ContentTypeDetail>(`${ctx.apiBase}/content/types/${encodeURIComponent(typeKey)}`, { notFoundOn404: true }),
    load<ItemList<ContentTypeSummary>>(`${ctx.apiBase}/content/types`, { query: { includeArchived: true } }),
    load<CursorPage<EntryListItem>>(`${ctx.apiBase}/content/entries`, {
      query: { type: typeKey, status: filters.status, q: filters.q || undefined, limit: 50, cursor: param(sp, "cursor") || undefined },
    }),
  ]);
  if (!type.ok) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        <PageHeader title={t("content.title")} breadcrumbs={[{ label: t("content.title"), href: `${ctx.basePath}/content` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={type.error} />
        </div>
      </div>
    );
  }
  const summary = list.ok ? list.data.items.find((x) => x.id === type.data.id) : undefined;
  const detail = { ...type.data, ...(summary?.entryCounts ? { entryCounts: summary.entryCounts } : {}) };
  const name = labelText(type.data.labels.name, locale, type.data.key);
  const plural = labelText(type.data.labels.namePlural, locale, type.data.key);
  const counts = detail.entryCounts ?? {};
  const existing = (counts.draft ?? 0) + (counts.published ?? 0) + (counts.scheduled ?? 0);
  const canCreate = ctx.permissions.includes("content:write") && type.data.status === "active" && !(type.data.kind === "singleton" && existing > 0);
  const path = typeIndexPath(type.data, ctx.store.defaultLocale, ctx.store.defaultLocale);
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader
        title={plural}
        breadcrumbs={[{ label: t("content.title"), href: `${ctx.basePath}/content` }]}
        meta={path ? <span className="font-mono">{path}</span> : type.data.kind === "taxonomy" ? t("content.types.termsNoUrl") : t("content.types.noRoutes")}
        actions={
          <>
            <ButtonLink href={`${ctx.basePath}/content/${encodeURIComponent(type.data.key)}/settings`}>
              <Settings2 aria-hidden="true" />
              {t("content.entries.typeSettings")}
            </ButtonLink>
            {canCreate ? (
              <ButtonLink href={`${ctx.basePath}/content/${encodeURIComponent(type.data.key)}/new`} variant="primary">
                <Plus aria-hidden="true" />
                {t("content.entries.new", { name })}
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <EntriesView type={detail} result={entries} filtered={Boolean(filters.q || filters.status)} />
    </div>
  );
}
