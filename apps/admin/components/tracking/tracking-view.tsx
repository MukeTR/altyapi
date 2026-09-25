"use client";

import { Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { ErrorState } from "@/components/ui/error-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import type { ConversionDelivery, TrackingConfig } from "@/lib/settings/types";
import { DeliveriesTable } from "./deliveries-table";
import { TrackingForm } from "./tracking-form";

/** Marketing › Tracking layer: protected-layer notice, configuration and the conversion log. */
export function TrackingView({ config, deliveries }: { config: ApiResult<TrackingConfig>; deliveries: ApiResult<ItemList<ConversionDelivery>> }) {
  const { t } = useI18n();
  const { can } = useStore();
  // Controlled from the URL so the tabs never switch between uncontrolled and controlled.
  const tab = useSearchParams().get("tab") === "deliveries" ? "deliveries" : "config";
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader title={t("tracking.title")} meta={t("tracking.meta")} />
      <InlineAlert tone="info" title={t("tracking.protected.title")}>
        <span className="flex items-start gap-1.5">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("tracking.protected.body")}</span>
        </span>
      </InlineAlert>
      {!can("tracking:manage") ? <InlineAlert tone="info">{t("tracking.readOnly")}</InlineAlert> : null}
      <Tabs
        aria-label={t("tracking.tabsLabel")}
        searchParam="tab"
        value={tab}
        items={[
          {
            value: "config",
            label: t("tracking.tabs.config"),
            content: config.ok ? (
              <TrackingForm key={config.data.version} config={config.data} />
            ) : (
              <div className="rounded-lg border border-border bg-surface">
                <ErrorState error={config.error} />
              </div>
            ),
          },
          { value: "deliveries", label: t("tracking.tabs.deliveries"), content: <DeliveriesTable result={deliveries} /> },
        ]}
      />
    </div>
  );
}
