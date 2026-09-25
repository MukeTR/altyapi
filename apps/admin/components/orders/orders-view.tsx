"use client";

import Link from "next/link";
import { Receipt, SearchX } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { SearchField } from "@/components/commerce/search-field";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { CursorPagination } from "@/components/data/pagination";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, ExternalButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import type { ApiResult } from "@/lib/api/server";
import type { CursorPage } from "@/lib/api/types";
import { PAYMENT_STATUSES, type OrderListItem } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

const TAB_STATUSES = ["awaiting_payment", "confirmed", "processing", "partially_fulfilled", "fulfilled", "cancelled", "returned"] as const;

export function OrdersView({ result, filtered }: { result: ApiResult<CursorPage<OrderListItem>>; filtered: boolean }) {
  const { t, locale } = useI18n();
  const { basePath, storefrontUrl } = useStore();
  const { params, setFilters, pending, clearHref } = useUrlFilters();

  const columns: Column<OrderListItem>[] = [
    {
      id: "number",
      header: t("orders.columns.number"),
      cell: (o) => (
        <Link href={`${basePath}/orders/${o.id}`} className="font-medium text-fg tabular">
          #{o.number}
        </Link>
      ),
    },
    { id: "date", header: t("orders.columns.date"), cell: (o) => <DateTime value={o.createdAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    { id: "customer", header: t("orders.columns.customer"), cell: (o) => <span className="block max-w-56 truncate">{o.email ?? t("common.none")}</span> },
    { id: "payment", header: t("orders.columns.payment"), cell: (o) => <StatusPill domain="payment" value={o.paymentStatus} /> },
    { id: "status", header: t("orders.columns.status"), cell: (o) => <StatusPill domain="order" value={o.status} /> },
    { id: "fulfillment", header: t("orders.columns.fulfillment"), cell: (o) => <StatusPill domain="fulfillment" value={o.fulfillmentStatus} /> },
    { id: "items", header: t("orders.columns.items"), align: "end", cell: (o) => formatNumber(o.itemCount, locale) },
    { id: "total", header: t("orders.columns.total"), align: "end", cell: (o) => <Money amount={o.total} currency={o.currency} /> },
    {
      id: "tags",
      header: t("orders.columns.tags"),
      cell: (o) =>
        o.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {o.tags.slice(0, 3).map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
            {o.tags.length > 3 ? <Badge>+{o.tags.length - 3}</Badge> : null}
          </span>
        ) : null,
    },
  ];

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  return (
    <section aria-label={t("orders.title")} className="min-w-0 rounded-lg border border-border bg-surface">
      <FilterTabs
        param="status"
        aria-label={t("orders.tabsLabel")}
        tabs={[{ value: null, label: t("commerce.filters.all") }, ...TAB_STATUSES.map((s) => ({ value: s, label: t(`orders.tabs.${s}`) }))]}
      />
      <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
        <SearchField label={t("orders.searchLabel")} className="w-full sm:w-80" />
        <div className="w-full sm:w-56">
          <Select
            aria-label={t("orders.paymentFilter")}
            value={params.get("paymentStatus") ?? "any"}
            onValueChange={(v) => setFilters({ paymentStatus: v === "any" ? null : v })}
            options={[{ value: "any", label: t("commerce.filters.anyPayment") }, ...PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`statuses.payment.${s}`) }))]}
          />
        </div>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">{t("commerce.filters.dateRange")}</legend>
          <label className="flex items-center gap-1.5 text-sm text-fg-muted">
            {t("commerce.filters.from")}
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFilters({ from: e.target.value || null })}
              className="h-8 rounded-md border border-border-control bg-surface px-2 text-base text-fg tabular"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-fg-muted">
            {t("commerce.filters.to")}
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setFilters({ to: e.target.value || null })}
              className="h-8 rounded-md border border-border-control bg-surface px-2 text-base text-fg tabular"
            />
          </label>
        </fieldset>
        {filtered ? (
          <ButtonLink href={clearHref} variant="ghost" size="md" className="ms-auto">
            {t("commerce.filters.clear")}
          </ButtonLink>
        ) : null}
      </div>
      <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
        {result.ok ? (
          <DataTable
            caption={t("orders.title")}
            columns={columns}
            rows={result.data.items}
            rowKey={(o) => o.id}
            empty={
              filtered ? (
                <EmptyState
                  icon={SearchX}
                  title={t("states.emptyFilteredTitle")}
                  description={t("states.emptyFilteredBody")}
                  actions={
                    <ButtonLink href={clearHref} variant="secondary">
                      {t("states.clearFilters")}
                    </ButtonLink>
                  }
                />
              ) : (
                <EmptyState
                  icon={Receipt}
                  title={t("orders.empty.title")}
                  description={t("orders.empty.body")}
                  actions={
                    <ExternalButtonLink href={storefrontUrl} newTabLabel={t("common.openInNewTab")}>
                      {t("orders.empty.viewStore")}
                    </ExternalButtonLink>
                  }
                />
              )
            }
            footer={result.data.nextCursor || params.get("cursor") ? <CursorPagination nextCursor={result.data.nextCursor} /> : null}
          />
        ) : (
          <ErrorState error={result.error} />
        )}
      </div>
      {pending ? <span className="sr-only" role="status">{t("common.loading")}</span> : null}
    </section>
  );
}
