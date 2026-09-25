import type { Metadata } from "next";
import { GeneralSettings } from "@/components/settings/general-settings";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("settings.general.title") };
}

/**
 * Settings › General. The store record is already loaded (fresh for this request) by the store
 * layout, so the form reads it from the store context; saving refreshes the route.
 */
export default async function GeneralSettingsPage({ params }: { params: Params }) {
  await requireStoreContext(params);
  return <GeneralSettings />;
}
