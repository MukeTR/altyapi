import type { Metadata } from "next";
import { LocationsView } from "@/components/inventory/locations-view";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import type { Location } from "@/lib/commerce/types";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("inventory.locations.title") };
}

export default async function LocationsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const result = await load<ItemList<Location>>(`${ctx.apiBase}/inventory/locations`);
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader title={t("inventory.locations.title")} breadcrumbs={[{ label: t("inventory.title"), href: `${ctx.basePath}/inventory` }]} />
      <LocationsView result={result} />
    </div>
  );
}
