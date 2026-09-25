"use client";

import { ExternalLink, Search } from "lucide-react";
import type { ReactNode } from "react";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { OffsetPagination } from "@/components/data/pagination";
import { Bps } from "@/components/data/percent";
import { PeerListError, VariantCell, WMoney } from "@/components/ekosistem/peer-status";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import type { ApiResult } from "@/lib/api/server";
import type { OffsetPage } from "@/lib/api/types";
import type { CompetitorOffer, KarmatikAlert, ProfitRow } from "@/lib/ekosistem/types";
import { useProfitColumns } from "./karmatik-overview";

function ListShell<T>({
  title,
  meta,
  result,
  columns,
  rowKey,
  filters,
  tabs,
  filtered,
  emptyTitle,
  emptyBody,
}: {
  title: string;
  meta: string;
  result: ApiResult<OffsetPage<T>>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  filters?: ReactNode;
  tabs?: ReactNode;
  filtered: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  const { t } = useI18n();
  const { clearHref } = useUrlFilters();
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={title} meta={meta} breadcrumbs={[{ label: t("karmatik.title") }]} />
      {!result.ok ? (
        <PeerListError peer="karmatik" error={result.error} />
      ) : (
        <section aria-label={title} className="min-w-0 rounded-lg border border-border bg-surface">
          {tabs}
          {filters ? <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">{filters}</div> : null}
          <DataTable
            caption={title}
            columns={columns}
            rows={result.data.items}
            rowKey={rowKey}
            empty={
              filtered ? (
                <EmptyState icon={Search} title={t("states.emptyFilteredTitle")} description={t("states.emptyFilteredBody")} actions={<ButtonLink href={clearHref}>{t("states.clearFilters")}</ButtonLink>} />
              ) : (
                <EmptyState title={emptyTitle} description={emptyBody} />
              )
            }
            footer={result.data.total > 0 ? <OffsetPagination offset={result.data.offset} limit={result.data.limit} total={result.data.total} /> : null}
          />
        </section>
      )}
    </div>
  );
}

/** Kârmatik › Profitability: per-variant profit rows, worst margin first. */
export function Profitability({ result, channels, filtered }: { result: ApiResult<OffsetPage<ProfitRow>>; channels: string[]; filtered: boolean }) {
  const { t } = useI18n();
  const { params, setFilters } = useUrlFilters();
  const columns = useProfitColumns();
  const extra: Column<ProfitRow>[] = [
    { id: "safe", header: t("karmatik.columns.safeDiscount"), align: "end", cell: (r) => <Bps value={r.safeDiscountBps} /> },
    { id: "updated", header: t("karmatik.columns.updated"), cell: (r) => <DateTime value={r.updatedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
  ];
  return (
    <ListShell
      title={t("karmatik.profitability.title")}
      meta={t("karmatik.profitability.meta")}
      result={result}
      columns={[...columns, ...extra]}
      rowKey={(r) => r.ref}
      filtered={filtered}
      emptyTitle={t("karmatik.profitability.emptyTitle")}
      emptyBody={t("karmatik.profitability.emptyBody")}
      tabs={
        <FilterTabs
          param="filter"
          aria-label={t("karmatik.profitability.filterLabel")}
          tabs={[
            { value: null, label: t("karmatik.profitability.filters.all") },
            { value: "loss_making", label: t("karmatik.profitability.filters.loss_making") },
            { value: "thin_margin", label: t("karmatik.profitability.filters.thin_margin") },
            { value: "unmatched", label: t("karmatik.profitability.filters.unmatched") },
          ]}
        />
      }
      filters={
        channels.length > 1 ? (
          <div className="w-full sm:w-56">
            <Select
              aria-label={t("karmatik.columns.channel")}
              value={params.get("channel") ?? "all"}
              onValueChange={(v) => setFilters({ channel: v === "all" ? null : v })}
              options={[{ value: "all", label: t("karmatik.allChannels") }, ...channels.map((c) => ({ value: c, label: t.maybe(`karmatik.channels.${c}`) ?? c }))]}
            />
          </div>
        ) : null
      }
    />
  );
}

const ALERT_TYPES = ["loss_making", "thin_margin", "missing_cost", "buybox_lost", "competitor_price_drop", "high_return", "other"] as const;

/** Kârmatik › Alerts: open or resolved alerts, most severe first. */
export function Alerts({ result, filtered }: { result: ApiResult<OffsetPage<KarmatikAlert>>; filtered: boolean }) {
  const { t } = useI18n();
  const { params, setFilters } = useUrlFilters();
  const columns: Column<KarmatikAlert>[] = [
    { id: "severity", header: t("karmatik.alerts.columns.severity"), cell: (a) => <StatusPill domain="alertSeverity" value={a.severity} /> },
    {
      id: "title",
      header: t("karmatik.alerts.columns.title"),
      cell: (a) => (
        <span className="flex max-w-md flex-col">
          <span className="font-medium text-fg">{a.title}</span>
          {a.body ? <span className="line-clamp-2 text-sm text-fg-muted">{a.body}</span> : null}
        </span>
      ),
    },
    { id: "type", header: t("karmatik.alerts.columns.type"), cell: (a) => <Badge>{t.maybe(`karmatik.alerts.types.${a.type}`) ?? a.type}</Badge> },
    { id: "product", header: t("karmatik.columns.product"), cell: (a) => <VariantCell variant={a.variant} fallback={[a.barcode, a.sourceRef]} /> },
    { id: "channel", header: t("karmatik.columns.channel"), cell: (a) => (a.channel ? (t.maybe(`karmatik.channels.${a.channel}`) ?? a.storeLabel ?? a.channel) : t("common.none")) },
    { id: "impact", header: t("karmatik.alerts.columns.impact"), align: "end", cell: (a) => <WMoney value={a.impactMonthly} /> },
    {
      id: "when",
      header: t("karmatik.alerts.columns.when"),
      cell: (a) => (a.resolvedAt ? <span className="text-sm text-success">{t("karmatik.alerts.resolved")} <DateTime value={a.resolvedAt} format="relative" /></span> : <DateTime value={a.updatedAt ?? a.createdAt} format="relative" className="whitespace-nowrap text-fg-muted" />),
    },
  ];
  return (
    <ListShell
      title={t("karmatik.alerts.title")}
      meta={t("karmatik.alerts.meta")}
      result={result}
      columns={columns}
      rowKey={(a) => a.ref}
      filtered={filtered}
      emptyTitle={t("karmatik.alerts.emptyTitle")}
      emptyBody={t("karmatik.alerts.emptyBody")}
      tabs={
        <FilterTabs
          param="status"
          aria-label={t("karmatik.alerts.statusLabel")}
          tabs={[
            { value: null, label: t("karmatik.alerts.status.open") },
            { value: "resolved", label: t("karmatik.alerts.status.resolved") },
            { value: "any", label: t("karmatik.alerts.status.all") },
          ]}
        />
      }
      filters={
        <>
          <div className="w-full sm:w-48">
            <Select
              aria-label={t("karmatik.alerts.columns.severity")}
              value={params.get("severity") ?? "all"}
              onValueChange={(v) => setFilters({ severity: v === "all" ? null : v })}
              options={[{ value: "all", label: t("karmatik.alerts.allSeverities") }, ...(["critical", "warning", "info"] as const).map((s) => ({ value: s, label: t(`statuses.alertSeverity.${s}`) }))]}
            />
          </div>
          <div className="w-full sm:w-56">
            <Select
              aria-label={t("karmatik.alerts.columns.type")}
              value={params.get("type") ?? "all"}
              onValueChange={(v) => setFilters({ type: v === "all" ? null : v })}
              options={[{ value: "all", label: t("karmatik.alerts.allTypes") }, ...ALERT_TYPES.map((s) => ({ value: s, label: t(`karmatik.alerts.types.${s}`) }))]}
            />
          </div>
        </>
      }
    />
  );
}

/** Kârmatik › Competitors: current competitor offers next to this store's own price. */
export function Competitors({ result, filtered }: { result: ApiResult<OffsetPage<CompetitorOffer>>; filtered: boolean }) {
  const { t } = useI18n();
  const columns: Column<CompetitorOffer>[] = [
    { id: "product", header: t("karmatik.columns.product"), cell: (c) => <VariantCell variant={c.variant} fallback={[c.barcode, c.sourceRef]} /> },
    { id: "source", header: t("karmatik.competitors.columns.source"), cell: (c) => <span className="flex flex-col"><span>{c.source}</span>{c.seller ? <span className="text-xs text-fg-muted">{c.seller}</span> : null}</span> },
    { id: "price", header: t("karmatik.competitors.columns.price"), align: "end", cell: (c) => <WMoney value={c.price} /> },
    { id: "ours", header: t("karmatik.competitors.columns.ours"), align: "end", cell: (c) => <WMoney value={c.variant?.price ?? null} /> },
    {
      id: "diff",
      header: t("karmatik.competitors.columns.difference"),
      align: "end",
      cell: (c) =>
        c.difference ? (
          <span className="flex flex-col items-end">
            <WMoney value={c.difference} className={c.difference.amount.startsWith("-") ? "tabular text-danger" : "tabular text-success"} />
            <span className="text-xs text-fg-muted">{c.difference.amount.startsWith("-") ? t("karmatik.competitors.cheaper") : t("karmatik.competitors.pricier")}</span>
          </span>
        ) : (
          t("common.none")
        ),
    },
    { id: "stock", header: t("karmatik.competitors.columns.stock"), cell: (c) => (c.inStock === null ? t("common.none") : c.inStock ? t("karmatik.competitors.inStock") : t("karmatik.competitors.outOfStock")) },
    { id: "observed", header: t("karmatik.competitors.columns.observed"), cell: (c) => <DateTime value={c.observedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    {
      id: "url",
      header: t("karmatik.competitors.columns.link"),
      srOnlyHeader: true,
      cell: (c) =>
        c.url && /^https?:\/\//.test(c.url) ? (
          <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sm">
            {t("karmatik.competitors.open")}
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only"> ({t("common.openInNewTab")})</span>
          </a>
        ) : null,
    },
  ];
  return (
    <ListShell
      title={t("karmatik.competitors.title")}
      meta={t("karmatik.competitors.meta")}
      result={result}
      columns={columns}
      rowKey={(c) => c.ref}
      filtered={filtered}
      emptyTitle={t("karmatik.competitors.emptyTitle")}
      emptyBody={t("karmatik.competitors.emptyBody")}
    />
  );
}
