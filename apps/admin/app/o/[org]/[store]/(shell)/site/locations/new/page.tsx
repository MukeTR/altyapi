import type { Metadata } from "next";
import { LocationForm } from "@/components/site/location-form";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("site.locations.new") };
}

/** Site › new location. */
export default async function NewLocationPage({ params }: { params: Params }) {
  await requireStoreContext(params);
  return <LocationForm initial={null} />;
}
