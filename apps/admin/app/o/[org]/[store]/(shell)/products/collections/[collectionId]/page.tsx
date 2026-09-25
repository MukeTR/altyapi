import type { Metadata } from "next";
import { CollectionForm } from "@/components/collections/collection-form";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ApiResult } from "@/lib/api/server";
import type { CursorPage, ItemList } from "@/lib/api/types";
import { mediaConfig } from "@/lib/commerce/media-server";
import type { Category, CollectionDetail, ProductListItem } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; collectionId: string }>;

/** The API caps a manual collection at 5000 products; members are read in pages of 200. */
const MEMBER_PAGES = 25;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store, collectionId } = await params;
  const { t } = await getI18n();
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const r = await load<CollectionDetail>(`${ctx.apiBase}/collections/${encodeURIComponent(collectionId)}`);
  return { title: r.ok ? (r.data.translations[ctx.store.defaultLocale]?.title ?? t("collections.title")) : t("collections.title") };
}

export default async function CollectionPage({ params }: { params: Params }) {
  const { org, store, collectionId } = await params;
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  const [collection, categories] = await Promise.all([
    load<CollectionDetail>(`${ctx.apiBase}/collections/${encodeURIComponent(collectionId)}`, { notFoundOn404: true }),
    load<ItemList<Category>>(`${ctx.apiBase}/categories`),
  ]);
  if (!collection.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("collections.title")} breadcrumbs={[{ label: t("collections.title"), href: `${ctx.basePath}/products/collections` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={collection.error} />
        </div>
      </div>
    );
  }
  // Every member, page by page (keyset, updated first).
  const members: ProductListItem[] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (let page = 0; page < MEMBER_PAGES; page++) {
    const r: ApiResult<CursorPage<ProductListItem>> = await load<CursorPage<ProductListItem>>(`${ctx.apiBase}/products`, {
      query: { collectionId, limit: 200, cursor: cursor ?? undefined },
    });
    if (!r.ok) break;
    members.push(...r.data.items);
    cursor = r.data.nextCursor;
    if (!cursor) break;
    if (page === MEMBER_PAGES - 1) truncated = true;
  }
  return (
    <CollectionForm
      key={collection.data.updatedAt}
      collection={collection.data}
      members={members}
      membersTruncated={truncated}
      categories={categories.ok ? categories.data.items : []}
      media={mediaConfig()}
    />
  );
}
