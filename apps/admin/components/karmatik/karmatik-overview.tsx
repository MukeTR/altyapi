"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Bps } from "@/components/data/percent";
import { Stat } from "@/components/data/stat";
import { FreshnessCard, NotLinked, VariantCell, WMoney } from "@/components/ekosistem/peer-status";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { ApiResult } from "@/lib/api/server";
import type { KarmatikOverview as Overview, ProfitRow } from "@/lib/ekosistem/types";
import { formatNumber } from "@/lib/format";

export function useProfitColumns(): Column<ProfitRow>[] {
  const { t } = useI18n();
  return [
    { id: "product", header: t("karmatik.columns.product"), cell: (r) => <VariantCell variant={r.variant} fallback={[r.sku, r.barcode, r.sourceRef]} /> },
    { id: "channel", header: t("karmatik.columns.channel"), cell: (r) => <span className="whitespace-nowrap">{t.maybe(`karmatik.channels.${r.channel}`) ?? r.storeLabel ?? r.channel}</span> },
    { id: "price", header: t("karmatik.columns.price"), align: "end", cell: (r) => <WMoney value={r.price} /> },
    { id: "net", header: t("karmatik.columns.netProfit"), align: "end", cell: (r) => <WMoney value={r.netProfit} /> },
    { id: "margin", header: t("karmatik.columns.margin"), align: "end", cell: (r) => <Bps value={r.marginBps} signed /> },
    { id: "floor", header: t("karmatik.columns.floor"), align: "end", cell: (r) => <WMoney value={r.floorPrice} /> },
    {
      id: "basis",
      header: t("karmatik.columns.basis"),
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.basis ? <Badge tone={r.basis === "estimated" ? "warning" : "neutral"}>{t.maybe(`karmatik.basis.${r.basis}`) ?? r.basis}</Badge> : null}
          {r.missing.map((m) => (
            <Badge key={m} tone="warning">
              {t("karmatik.missing", { what: t.maybe(`karmatik.missingFields.${m}`) ?? m })}
            </Badge>
          ))}
        </span>
      ),
    },
  ];
}

/** Kârmatik › Overview: link freshness, profitability counts, worst variants, suggestions, alerts, competitors. */
export function KarmatikOverview({ result }: { result: ApiResult<Overview> }) {
  const { t, locale } = useI18n();
  const { basePath, can } = useStore();
  const columns = useProfitColumns();
  const header = <PageHeader title={t("karmatik.title")} meta={t("karmatik.meta")} />;
  if (!result.ok) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        {header}
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={result.error} />
        </div>
      </div>
    );
  }
  const o = result.data;
  if (!o.linked) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        {header}
        <NotLinked peer="karmatik" link={o.link} configured={o.configured} />
      </div>
    );
  }
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      {header}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card title={t("karmatik.overview.profitTitle")} description={o.profit?.newest ? undefined : t("karmatik.overview.noProfit")} className="lg:col-span-8">
          {o.profit ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label={t("karmatik.overview.tracked")} value={n(o.profit.total)} hint={t("karmatik.overview.matched", { count: n(o.profit.matched) })} />
                <Stat label={t("karmatik.overview.lossMaking")} value={<span className={o.profit.lossMaking ? "text-danger" : undefined}>{n(o.profit.lossMaking)}</span>} />
                <Stat label={t("karmatik.overview.thinMargin")} value={<span className={o.profit.thinMargin ? "text-warning" : undefined}>{n(o.profit.thinMargin)}</span>} />
                <Stat label={t("karmatik.overview.missingCost")} value={n(o.profit.missingCost)} />
                <Stat label={t("karmatik.overview.estimated")} value={n(o.profit.estimated)} hint={t("karmatik.overview.estimatedHint")} />
              </div>
              {o.profit.newest ? (
                <p className="text-xs text-fg-subtle">
                  {t("karmatik.overview.updated")} <DateTime value={o.profit.newest} format="relative" />
                </p>
              ) : null}
              {o.profit.byChannel.length ? (
                <ul className="flex flex-wrap gap-2">
                  {o.profit.byChannel.map((c) => (
                    <li key={c.channel}>
                      <Badge>
                        {t.maybe(`karmatik.channels.${c.channel}`) ?? c.channel}: {n(c.total)} · {t("karmatik.overview.lossShort", { count: n(c.lossMaking) })}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Card>
        <FreshnessCard freshness={o.freshness} circuit={o.circuit} nextPullAt={o.nextPullAt} className="lg:col-span-4" />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card
          title={t("karmatik.overview.suggestionsTitle")}
          className="lg:col-span-4"
          actions={
            <Link href={`${basePath}/karmatik/suggestions`} className="text-sm">
              {t("karmatik.overview.viewAll")}
            </Link>
          }
        >
          {o.suggestions ? (
            <div className="grid grid-cols-2 gap-4">
              <Stat label={t("karmatik.overview.actionable")} value={n(o.suggestions.actionable)} hint={t("karmatik.overview.openAll", { count: n(o.suggestions.open) })} />
              <Stat label={t("karmatik.overview.applied")} value={n(o.suggestions.applied)} hint={t("karmatik.overview.dismissed", { count: n(o.suggestions.dismissed) })} />
              {o.suggestions.undelivered ? <p className="col-span-2 text-sm text-warning">{t("karmatik.overview.undelivered", { count: n(o.suggestions.undelivered) })}</p> : null}
            </div>
          ) : null}
        </Card>
        <Card
          title={t("karmatik.overview.alertsTitle")}
          className="lg:col-span-4"
          actions={
            <Link href={`${basePath}/karmatik/alerts`} className="text-sm">
              {t("karmatik.overview.viewAll")}
            </Link>
          }
        >
          {o.alerts ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {(["critical", "warning", "info"] as const).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 text-sm">
                    <StatusPill domain="alertSeverity" value={s} />
                    <span className="tabular">{n(o.alerts?.bySeverity[s] ?? 0)}</span>
                  </span>
                ))}
              </div>
              {o.alerts.latest.length ? (
                <ul className="flex flex-col gap-1.5">
                  {o.alerts.latest.slice(0, 3).map((a) => (
                    <li key={a.ref} className="text-sm">
                      <span className="text-fg">{a.title}</span>
                      {a.variant?.productTitle ? <span className="text-fg-muted"> · {a.variant.productTitle}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">{t("karmatik.overview.noAlerts")}</p>
              )}
            </div>
          ) : null}
        </Card>
        <Card
          title={t("karmatik.overview.competitorsTitle")}
          className="lg:col-span-4"
          actions={
            <Link href={`${basePath}/karmatik/competitors`} className="text-sm">
              {t("karmatik.overview.viewAll")}
            </Link>
          }
        >
          {o.competitors ? (
            <div className="grid grid-cols-2 gap-4">
              <Stat label={t("karmatik.overview.offers")} value={n(o.competitors.offers)} />
              <Stat label={t("karmatik.overview.variantsTracked")} value={n(o.competitors.variantsTracked)} />
              {o.competitors.newest ? (
                <p className="col-span-2 text-xs text-fg-subtle">
                  {t("karmatik.overview.updated")} <DateTime value={o.competitors.newest} format="relative" />
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <Card flush title={t("karmatik.overview.worstTitle")} description={t("karmatik.overview.worstDescription")}>
        <DataTable caption={t("karmatik.overview.worstTitle")} columns={columns} rows={o.profit?.lossMakingVariants ?? []} rowKey={(r) => r.ref} empty={<EmptyState title={t("karmatik.overview.noLoss")} />} />
      </Card>
      <Card flush title={t("karmatik.overview.thinTitle")} description={t("karmatik.overview.thinDescription")}>
        <DataTable caption={t("karmatik.overview.thinTitle")} columns={columns} rows={o.profit?.thinMarginVariants ?? []} rowKey={(r) => r.ref} empty={<EmptyState title={t("karmatik.overview.noThin")} />} />
      </Card>

      <Card title={t("karmatik.overview.guardTitle")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-base text-fg">
            <ShieldCheck aria-hidden="true" className="size-4 text-fg-muted" />
            {t("karmatik.overview.guardPolicy")}: <strong className="font-medium">{t(`karmatik.guard.policies.${o.profitGuard}.title`)}</strong>
          </p>
          {can("settings:read") ? (
            <Link href={`${basePath}/karmatik/settings`} className="text-sm">
              {t("karmatik.overview.guardLink")}
            </Link>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
