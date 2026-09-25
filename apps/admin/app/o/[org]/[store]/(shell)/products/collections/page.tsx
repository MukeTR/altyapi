import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { CollectionsView } from "@/components/collections/collections-view";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { CollectionListItem } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("collections.title") };
}

/** Manual and automated collections (complete list, sortable). */
export default async function CollectionsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const result = await load<ItemList<CollectionListItem>>(`${ctx.apiBase}/collections`);
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader
        title={t("collections.title")}
        breadcrumbs={[{ label: t("products.title"), href: `${ctx.basePath}/products` }]}
        actions={
          ctx.permissions.includes("catalog:write") ? (
            <ButtonLink href={`${ctx.basePath}/products/collections/new`} variant="primary">
              <Plus aria-hidden="true" />
              {t("collections.actions.new")}
            </ButtonLink>
          ) : null
        }
      />
      <CollectionsView result={result} />
    </div>
  );
}
