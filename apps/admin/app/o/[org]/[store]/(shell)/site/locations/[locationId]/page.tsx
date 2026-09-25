import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocationForm } from "@/components/site/location-form";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { load } from "@/lib/api/load";
import { labelText } from "@/lib/content/fields";
import { getI18n } from "@/lib/i18n/server";
import type { SiteLocation } from "@/lib/site/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string; locationId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { org, store, locationId } = await params;
  const { t, locale } = await getI18n();
  if (!UUID.test(locationId)) return { title: t("site.locations.title") };
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const l = await load<SiteLocation>(`${ctx.apiBase}/site/locations/${locationId}`);
  return { title: l.ok ? labelText(l.data.name, locale, l.data.slug) : t("site.locations.title") };
}

/** Site › location editor. */
export default async function LocationPage({ params }: { params: Params }) {
  const { org, store, locationId } = await params;
  if (!UUID.test(locationId)) notFound();
  const ctx = await requireStoreContext(Promise.resolve({ org, store }));
  const { t } = await getI18n();
  const location = await load<SiteLocation>(`${ctx.apiBase}/site/locations/${locationId}`, { notFoundOn404: true });
  if (!location.ok) {
    return (
      <div className="mx-auto flex max-w-[960px] flex-col gap-6">
        <PageHeader title={t("site.locations.title")} breadcrumbs={[{ label: t("site.locations.title"), href: `${ctx.basePath}/site/locations` }]} />
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={location.error} />
        </div>
      </div>
    );
  }
  return <LocationForm key={location.data.updatedAt} initial={location.data} />;
}
