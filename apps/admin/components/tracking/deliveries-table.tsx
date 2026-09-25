"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { useState } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { LoadMore } from "@/components/data/pagination";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StatusPill } from "@/components/ui/status-pill";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import { DELIVERIES_PAGE, type ConversionDelivery } from "@/lib/settings/types";

/**
 * Server-side conversion log (Meta CAPI, TikTok Events API, GA4 Measurement Protocol): one row per
 * event sent, newest first. "Load more" pages with before=<oldest createdAt>.
 */
export function DeliveriesTable({ result }: { result: ApiResult<ItemList<ConversionDelivery>> }) {
  const { t } = useI18n();
  const { apiBase, basePath, can } = useStore();
  const [rows, setRows] = useState<ConversionDelivery[]>(result.ok ? result.data.items : []);
  const [hasMore, setHasMore] = useState(result.ok && result.data.items.length === DELIVERIES_PAGE);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState<ApiErrorInfo | null>(null);

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoading(true);
    setMoreError(null);
    try {
      const page = await bff<ItemList<ConversionDelivery>>(`${apiBase}/tracking/deliveries`, { query: { limit: DELIVERIES_PAGE, before: new Date(last.createdAt).toISOString() } });
      setRows((cur) => [...cur, ...page.items]);
      setHasMore(page.items.length === DELIVERIES_PAGE);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setMoreError(err.toInfo());
    } finally {
      setLoading(false);
    }
  };

  const columns: Column<ConversionDelivery>[] = [
    { id: "date", header: t("tracking.deliveries.columns.date"), cell: (d) => <DateTime value={d.createdAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    { id: "destination", header: t("tracking.deliveries.columns.destination"), cell: (d) => t.maybe(`tracking.destinations.${d.destination}`) ?? d.destination },
    { id: "event", header: t("tracking.deliveries.columns.event"), cell: (d) => <code className="font-mono text-sm">{d.eventName}</code> },
    { id: "status", header: t("tracking.deliveries.columns.status"), cell: (d) => <StatusPill domain="delivery" value={d.status} /> },
    { id: "http", header: t("tracking.deliveries.columns.http"), align: "end", cell: (d) => (d.httpStatus === null ? t("common.none") : String(d.httpStatus)) },
    {
      id: "order",
      header: t("tracking.deliveries.columns.order"),
      cell: (d) =>
        d.orderId && can("orders:read") ? (
          <Link href={`${basePath}/orders/${d.orderId}`}>{t("tracking.deliveries.viewOrder")}</Link>
        ) : (
          <span className="text-fg-subtle">{t("common.none")}</span>
        ),
    },
    { id: "message", header: t("tracking.deliveries.columns.message"), cell: (d) => <span className="block max-w-80 truncate text-sm text-fg-muted" title={d.message ?? undefined}>{d.message ?? ""}</span> },
  ];

  return (
    <section aria-label={t("tracking.deliveries.title")} className="min-w-0 rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-md font-semibold text-fg">{t("tracking.deliveries.title")}</h2>
        <p className="text-sm text-fg-muted">{t("tracking.deliveries.description")}</p>
      </div>
      <DataTable
        caption={t("tracking.deliveries.title")}
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        error={!result.ok ? <ErrorState error={result.error} /> : undefined}
        empty={<EmptyState icon={Activity} title={t("tracking.deliveries.emptyTitle")} description={t("tracking.deliveries.emptyBody")} />}
        footer={
          <>
            {moreError ? <ErrorState compact error={moreError} onRetry={() => void loadMore()} /> : null}
            <LoadMore hasMore={hasMore} loading={loading} onLoadMore={() => void loadMore()} />
          </>
        }
      />
    </section>
  );
}
