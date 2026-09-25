"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { KeyValue } from "@/components/data/key-value";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { intlLocale } from "@/lib/i18n/config";
import { localeLabel } from "@/lib/locales";

/** Core settings of the current store, straight from GET /v1/organizations/:id/stores/:id. */
export function StoreSummaryCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const { store, storefrontUrl } = useStore();
  const regions = new Intl.DisplayNames([intlLocale(locale)], { type: "region" });
  const host = new URL(storefrontUrl).host;
  return (
    <Card title={t("overview.storeCard.title")} description={t("overview.storeCard.description")} className={className}>
      <KeyValue
        items={[
          {
            label: t("overview.storeCard.address"),
            value: (
              <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-sm">
                {host}
                <span className="sr-only"> ({t("common.openInNewTab")})</span>
              </a>
            ),
            copy: { value: storefrontUrl, label: t("overview.storeCard.address") },
          },
          { label: t("overview.storeCard.status"), value: <StatusPill domain="store" value={store.status} /> },
          { label: t("overview.storeCard.defaultLocale"), value: localeLabel(store.defaultLocale, locale) },
          {
            label: t("overview.storeCard.locales"),
            value: (
              <span className="flex flex-wrap gap-1">
                {store.supportedLocales.map((l) => (
                  <Badge key={l}>{localeLabel(l, locale)}</Badge>
                ))}
              </span>
            ),
          },
          { label: t("overview.storeCard.currency"), value: store.defaultCurrency },
          { label: t("overview.storeCard.currencies"), value: store.supportedCurrencies.join(", ") },
          { label: t("overview.storeCard.timezone"), value: store.timezone },
          { label: t("overview.storeCard.country"), value: `${regions.of(store.countryCode) ?? store.countryCode} (${store.countryCode})` },
        ]}
      />
    </Card>
  );
}
