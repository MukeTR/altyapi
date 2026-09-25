"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Tags } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { SearchField } from "@/components/commerce/search-field";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { buttonClasses } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";
import { LISTINGS_PAGE, type ExternalListing, type IntegrationConnection } from "@/lib/integrations/types";

/** Offset paging for an endpoint that returns no total: "next" is offered while a page is full. */
function OffsetNav({ offset, count }: { offset: number; count: number }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (o: number) => {
    const q = new URLSearchParams(params.toString());
    if (o > 0) q.set("offset", String(o));
    else q.delete("offset");
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const hasPrev = offset > 0;
  const hasNext = count === LISTINGS_PAGE;
  const disabled = "pointer-events-none opacity-55";
  return (
    <nav aria-label={t("ui.table.pagination")} className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
      <span className="text-sm text-fg-muted tabular">
        {t("integrations.listings.range", { from: formatNumber(count ? offset + 1 : 0, locale), to: formatNumber(offset + count, locale) })}
      </span>
      <div className="flex items-center gap-2">
        <Link href={href(Math.max(0, offset - LISTINGS_PAGE))} aria-disabled={!hasPrev || undefined} tabIndex={hasPrev ? undefined : -1} className={buttonClasses("secondary", "sm", hasPrev ? undefined : disabled)}>
          <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
          {t("ui.table.previous")}
        </Link>
        <Link href={href(offset + LISTINGS_PAGE)} aria-disabled={!hasNext || undefined} tabIndex={hasNext ? undefined : -1} className={buttonClasses("secondary", "sm", hasNext ? undefined : disabled)}>
          {t("ui.table.next")}
          <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
        </Link>
      </div>
    </nav>
  );
}

/**
 * Apps & Integrations › Channel listings: products as they exist on each connected channel, with
 * whether their SKU or barcode matched a variant of this store.
 */
export function Listings({ result, connections, offset, filtered }: { result: ApiResult<ItemList<ExternalListing>>; connections: IntegrationConnection[]; offset: number; filtered: boolean }) {
  const { t, locale } = useI18n();
  const { basePath } = useStore();
  const { params, setFilters, clearHref } = useUrlFilters();
  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  const rows = result.ok ? result.data.items : [];

  const columns: Column<ExternalListing>[] = [
    { id: "sku", header: t("integrations.listings.columns.sku"), cell: (l) => <span className="font-mono text-sm">{l.sku ?? t("common.none")}</span> },
    { id: "title", header: t("integrations.listings.columns.title"), cell: (l) => <span className="block max-w-80 truncate" title={l.title ?? undefined}>{l.title ?? ""}</span> },
    { id: "barcode", header: t("integrations.listings.columns.barcode"), cell: (l) => <span className="font-mono text-sm text-fg-muted">{l.barcode ?? ""}</span> },
    { id: "connection", header: t("integrations.listings.columns.connection"), cell: (l) => nameOf(l.connectionId) },
    { id: "stock", header: t("integrations.listings.columns.stock"), align: "end", cell: (l) => (l.stock === null ? t("common.none") : formatNumber(l.stock, locale)) },
    { id: "price", header: t("integrations.listings.columns.price"), align: "end", cell: (l) => (l.currency ? <Money amount={l.price} currency={l.currency} compareAt={l.listPrice && l.listPrice !== l.price ? l.listPrice : null} /> : t("common.none")) },
    {
      id: "active",
      header: t("integrations.listings.columns.active"),
      cell: (l) => (l.active === null ? t("common.none") : l.active ? <Badge tone="success">{t("integrations.listings.onSale")}</Badge> : <Badge>{t("integrations.listings.offSale")}</Badge>),
    },
    {
      id: "match",
      header: t("integrations.listings.columns.match"),
      cell: (l) => (l.variantId ? <Badge tone="info">{t("integrations.listings.matched")}</Badge> : <Badge tone="warning">{t("integrations.listings.unmatched")}</Badge>),
    },
    { id: "seen", header: t("integrations.listings.columns.seen"), cell: (l) => <DateTime value={l.lastSeenAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
  ];

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("integrations.listings.title")} meta={t("integrations.listings.meta")} />
      <section aria-label={t("integrations.listings.title")} className="min-w-0 rounded-lg border border-border bg-surface">
        <FilterTabs
          param="unmatched"
          aria-label={t("integrations.listings.matchTabs")}
          tabs={[
            { value: null, label: t("integrations.filters.all") },
            { value: "true", label: t("integrations.listings.onlyUnmatched") },
          ]}
        />
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
          <SearchField param="sku" label={t("integrations.listings.searchSku")} className="w-full sm:w-72" />
          <div className="w-full sm:w-64">
            <Select
              aria-label={t("integrations.filters.connection")}
              value={params.get("connectionId") ?? "all"}
              onValueChange={(v) => setFilters({ connectionId: v === "all" ? null : v })}
              options={[{ value: "all", label: t("integrations.filters.allConnections") }, ...connections.filter((c) => c.capabilities?.readListings).map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>
          {filtered ? (
            <ButtonLink href={clearHref} variant="ghost">
              {t("states.clearFilters")}
            </ButtonLink>
          ) : null}
        </div>
        <DataTable
          caption={t("integrations.listings.title")}
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          error={!result.ok ? <ErrorState error={result.error} /> : undefined}
          empty={
            filtered || offset > 0 ? (
              <EmptyState title={t("states.emptyFilteredTitle")} description={t("states.emptyFilteredBody")} actions={<ButtonLink href={clearHref}>{t("states.clearFilters")}</ButtonLink>} />
            ) : (
              <EmptyState icon={Tags} title={t("integrations.listings.emptyTitle")} description={t("integrations.listings.emptyBody")} actions={<ButtonLink href={`${basePath}/apps`}>{t("integrations.backToApps")}</ButtonLink>} />
            )
          }
          footer={result.ok && (rows.length || offset > 0) ? <OffsetNav offset={offset} count={rows.length} /> : null}
        />
      </section>
    </div>
  );
}
