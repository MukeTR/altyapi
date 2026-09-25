import type { Metadata } from "next";
import { TrackingView } from "@/components/tracking/tracking-view";
import { load } from "@/lib/api/load";
import type { ItemList } from "@/lib/api/types";
import { getI18n } from "@/lib/i18n/server";
import { DELIVERIES_PAGE, type ConversionDelivery, type TrackingConfig } from "@/lib/settings/types";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tracking.title") };
}

/** Marketing › Tracking layer (tracking:read; saving needs tracking:manage and a human session). */
export default async function TrackingPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const [config, deliveries] = await Promise.all([
    load<TrackingConfig>(`${ctx.apiBase}/tracking`),
    load<ItemList<ConversionDelivery>>(`${ctx.apiBase}/tracking/deliveries`, { query: { limit: DELIVERIES_PAGE } }),
  ]);
  return <TrackingView config={config} deliveries={deliveries} />;
}
