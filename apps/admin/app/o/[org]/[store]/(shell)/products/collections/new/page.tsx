import type { Metadata } from "next";
import { CollectionForm } from "@/components/collections/collection-form";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { Category } from "@/lib/commerce/types";
import { mediaConfig } from "@/lib/commerce/media-server";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("collections.new.title") };
}

export default async function NewCollectionPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const categories = await load<ItemList<Category>>(`${ctx.apiBase}/categories`);
  return <CollectionForm collection={null} members={[]} membersTruncated={false} categories={categories.ok ? categories.data.items : []} media={mediaConfig()} />;
}
