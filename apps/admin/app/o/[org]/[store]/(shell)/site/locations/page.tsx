import type { Metadata } from "next";
import { LocationsView } from "@/components/site/locations-view";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import type { SiteLocation } from "@/lib/site/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("site.locations.title") };
}

/** Site › locations. */
export default async function LocationsPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const locations = await load<ItemList<SiteLocation>>(`${ctx.apiBase}/site/locations`);
  if (!locations.ok) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <PageHeader title={t("site.locations.title")} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={locations.error} />
        </div>
      </div>
    );
  }
  return <LocationsView initial={locations.data.items} />;
}
