import type { Metadata } from "next";
import { PriceListsView } from "@/components/products/price-lists-view";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { PriceList } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("pricelists.title") };
}

export default async function PriceListsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const result = await load<ItemList<PriceList>>(`${ctx.apiBase}/price-lists`);
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader title={t("pricelists.title")} breadcrumbs={[{ label: t("products.title"), href: `${ctx.basePath}/products` }]} />
      <PriceListsView result={result} />
    </div>
  );
}
