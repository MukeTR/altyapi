"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Package, SearchX } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { SearchField } from "@/components/commerce/search-field";
import { Thumb } from "@/components/commerce/thumb";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { BulkActionBar, DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { CursorPagination } from "@/components/data/pagination";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiResult } from "@/lib/api/server";
import type { CursorPage } from "@/lib/api/types";
import { mediaUrl, type MediaConfig } from "@/lib/commerce/media";
import type { CollectionListItem, ProductListItem } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

type BulkStatus = "active" | "draft" | "archived";

export function ProductsView({ result, collections, filtered, media }: { result: ApiResult<CursorPage<ProductListItem>>; collections: CollectionListItem[]; filtered: boolean; media: MediaConfig }) {
  const { t, locale } = useI18n();
  const { basePath, apiBase, can } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const { params, setFilters, pending, clearHref } = useUrlFilters();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState<BulkStatus | null>(null);
  const canWrite = can("catalog:write");

  const bulk = async (status: BulkStatus) => {
    setBulkPending(status);
    try {
      const res = await bff<{ updated: number }>(`${apiBase}/products/bulk-status`, { method: "POST", body: { productIds: [...selected], status } });
      toast({ tone: "success", title: t("products.bulk.done", { count: res.updated, status: t(`statuses.product.${status}`) }) });
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBulkPending(null);
    }
  };

  const columns: Column<ProductListItem>[] = [
    {
      id: "title",
      header: t("products.columns.product"),
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <Thumb src={mediaUrl(media, p.imageObjectKey)} />
          <span className="flex min-w-0 flex-col">
            <Link href={`${basePath}/products/${p.id}`} className="truncate font-medium text-fg">
              {p.title || t("products.untitled")}
            </Link>
            {p.skus.length ? <span className="truncate font-mono text-xs text-fg-subtle">{p.skus.slice(0, 3).join(", ")}{p.skus.length > 3 ? "…" : ""}</span> : null}
          </span>
        </span>
      ),
    },
    { id: "status", header: t("products.columns.status"), cell: (p) => <StatusPill domain="product" value={p.status} /> },
    {
      id: "stock",
      header: t("products.columns.stock"),
      align: "end",
      cell: (p) => (
        <span className={cn("whitespace-nowrap", p.totalAvailable <= 0 && "text-warning")}>
          {t("products.stockSummary", { stock: formatNumber(p.totalAvailable, locale), variants: formatNumber(p.variantCount, locale) })}
        </span>
      ),
    },
    {
      id: "price",
      header: t("products.columns.price"),
      align: "end",
      cell: (p) =>
        p.priceMin && p.priceMax && p.priceMin !== p.priceMax ? (
          <span className="whitespace-nowrap">
            <Money amount={p.priceMin} currency={p.currency} /> – <Money amount={p.priceMax} currency={p.currency} />
          </span>
        ) : (
          <Money amount={p.priceMin} currency={p.currency} />
        ),
    },
    { id: "updated", header: t("products.columns.updated"), cell: (p) => <DateTime value={p.updatedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
  ];

  const rows = result.ok ? result.data.items : [];

  return (
    <section aria-label={t("products.title")} className="min-w-0 rounded-lg border border-border bg-surface">
      <FilterTabs
        param="status"
        aria-label={t("products.tabsLabel")}
        tabs={[
          { value: null, label: t("commerce.filters.all") },
          { value: "active", label: t("statuses.product.active") },
          { value: "draft", label: t("statuses.product.draft") },
          { value: "archived", label: t("statuses.product.archived") },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <SearchField label={t("products.searchLabel")} className="w-full sm:w-80" />
        {collections.length > 0 ? (
          <div className="w-full sm:w-56">
            <Select
              aria-label={t("products.collectionFilter")}
              value={params.get("collectionId") ?? "any"}
              onValueChange={(v) => setFilters({ collectionId: v === "any" ? null : v })}
              options={[{ value: "any", label: t("products.anyCollection") }, ...collections.map((c) => ({ value: c.id, label: c.title || c.handle }))]}
            />
          </div>
        ) : null}
        <SearchField param="tag" label={t("products.tagFilter")} className="w-full sm:w-56" />
        {filtered ? (
          <ButtonLink href={clearHref} variant="ghost" className="ms-auto">
            {t("commerce.filters.clear")}
          </ButtonLink>
        ) : null}
      </div>
      <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
        {result.ok ? (
          <DataTable
            caption={t("products.title")}
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            {...(canWrite ? { selection: { selected, onChange: setSelected, rowLabel: (p: ProductListItem) => p.title || p.id } } : {})}
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
                  icon={Package}
                  title={t("products.empty.title")}
                  description={t("products.empty.body")}
                  actions={
                    canWrite ? (
                      <>
                        <ButtonLink href={`${basePath}/products/new`} variant="primary">
                          {t("products.actions.new")}
                        </ButtonLink>
                        <ButtonLink href={`${basePath}/products/imports/new`}>{t("products.actions.import")}</ButtonLink>
                      </>
                    ) : null
                  }
                />
              )
            }
            footer={result.data.nextCursor || params.get("cursor") ? <CursorPagination nextCursor={result.data.nextCursor} orderLabel={t("products.order")} /> : null}
          />
        ) : (
          <ErrorState error={result.error} />
        )}
      </div>
      {canWrite ? (
        <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
          {(["active", "draft", "archived"] as const).map((s) => (
            <Button key={s} size="sm" loading={bulkPending === s} disabled={bulkPending !== null} onClick={() => bulk(s)}>
              {t(`products.bulk.${s}`)}
            </Button>
          ))}
        </BulkActionBar>
      ) : null}
    </section>
  );
}
