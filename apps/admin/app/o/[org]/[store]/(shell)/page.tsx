import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, KarmatikCard, LowStockCard, OrdersWindowCard, RecentOrdersCard, YanitCard } from "@/components/overview/dashboard-cards";
import { StoreSummaryCard } from "@/components/overview/store-summary-card";
import { PageHeader } from "@/components/ui/page-header";
import { mediaConfig } from "@/lib/commerce/media-server";
import { getI18n } from "@/lib/i18n/server";
import { requireStoreContext } from "@/lib/store-context";

type Params = Promise<{ org: string; store: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("overview.title") };
}

/**
 * Store overview built only from real endpoints. Every card streams on its own (Suspense) and
 * shows its own error, so a slow or failing source never blocks the rest. Cards whose source
 * the user cannot read, or that is not connected (Kârmatik, Yanıt), are left out.
 */
export default async function OverviewPage({ params }: { params: Params }) {
  const ctx = await requireStoreContext(params);
  const { t } = await getI18n();
  const can = (p: string) => ctx.permissions.includes(p);
  const media = mediaConfig();
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("overview.title")} meta={ctx.store.name} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {can("orders:read") ? (
          <Suspense fallback={<CardSkeleton chart className="lg:col-span-8" />}>
            <OrdersWindowCard ctx={ctx} className="lg:col-span-8" />
          </Suspense>
        ) : null}
        {can("orders:read") ? (
          <Suspense fallback={<CardSkeleton className="lg:col-span-4" />}>
            <RecentOrdersCard ctx={ctx} className="lg:col-span-4" />
          </Suspense>
        ) : null}
        {can("catalog:read") ? (
          <Suspense fallback={<CardSkeleton className="lg:col-span-6" />}>
            <LowStockCard ctx={ctx} media={media} className="lg:col-span-6" />
          </Suspense>
        ) : null}
        {can("karmatik:read") ? (
          <Suspense fallback={<CardSkeleton className="lg:col-span-6" />}>
            <KarmatikCard ctx={ctx} className="lg:col-span-6" />
          </Suspense>
        ) : null}
        {can("yanit:read") ? (
          <Suspense fallback={<CardSkeleton className="lg:col-span-6" />}>
            <YanitCard ctx={ctx} className="lg:col-span-6" />
          </Suspense>
        ) : null}
        <StoreSummaryCard className="lg:col-span-6" />
      </div>
    </div>
  );
}
