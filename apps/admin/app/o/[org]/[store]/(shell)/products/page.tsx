import type { Metadata } from "next";
import { Plus, Upload } from "lucide-react";
import { ProductsView } from "@/components/products/products-view";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { CursorPage, ItemList } from "@/lib/api/types";
import { mediaConfig } from "@/lib/commerce/media-server";
import { oneOf, param } from "@/lib/commerce/query";
import type { CollectionListItem, ProductListItem } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("products.title") };
}

/** Catalog list: full-text search, status tabs, collection/tag/SKU filters and bulk status. */
export default async function ProductsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const ctx = await requireStoreContext(params);
  const sp = await searchParams;
  const { t } = await getI18n();
  const filters = {
    q: param(sp, "q"),
    status: oneOf(param(sp, "status"), ["draft", "active", "archived"] as const),
    collectionId: param(sp, "collectionId"),
    tag: param(sp, "tag"),
    sku: param(sp, "sku"),
  };
  const [result, collections] = await Promise.all([
    load<CursorPage<ProductListItem>>(`${ctx.apiBase}/products`, {
      query: {
        q: filters.q || undefined,
        status: filters.status,
        collectionId: /^[0-9a-f-]{36}$/i.test(filters.collectionId) ? filters.collectionId : undefined,
        tag: filters.tag || undefined,
        sku: filters.sku || undefined,
        limit: 50,
        cursor: param(sp, "cursor") || undefined,
      },
    }),
    load<ItemList<CollectionListItem>>(`${ctx.apiBase}/collections`),
  ]);
  const filtered = Boolean(filters.q || filters.status || filters.collectionId || filters.tag || filters.sku);
  const canWrite = ctx.permissions.includes("catalog:write");
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader
        title={t("products.title")}
        actions={
          canWrite ? (
            <>
              <ButtonLink href={`${ctx.basePath}/products/imports/new`}>
                <Upload aria-hidden="true" />
                {t("products.actions.import")}
              </ButtonLink>
              <ButtonLink href={`${ctx.basePath}/products/new`} variant="primary">
                <Plus aria-hidden="true" />
                {t("products.actions.new")}
              </ButtonLink>
            </>
          ) : null
        }
      />
      <ProductsView result={result} collections={collections.ok ? collections.data.items : []} filtered={filtered} media={mediaConfig()} />
    </div>
  );
}
