"use client";

import { CheckCheck, Crown, Scale } from "lucide-react";
import { useState } from "react";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { LoadMore } from "@/components/data/pagination";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";
import { DISCREPANCIES_PAGE, type Discrepancy } from "@/lib/integrations/types";

/**
 * Apps & Integrations › Discrepancies: the same fact (stock, price) differs between altyapi and a
 * connected system. The owner's value is marked; nothing is corrected automatically. Open items can
 * be acknowledged; they resolve on their own when the values agree again.
 */
export function Discrepancies({ result, status, field }: { result: ApiResult<ItemList<Discrepancy>>; status: string; field: string | null }) {
  const { t, locale } = useI18n();
  const { apiBase, basePath, can, store } = useStore();
  const { setFilters, clearHref } = useUrlFilters();
  const { toast, toastError } = useToast();
  const [rows, setRows] = useState<Discrepancy[]>(result.ok ? result.data.items : []);
  const [hasMore, setHasMore] = useState(result.ok && result.data.items.length === DISCREPANCIES_PAGE);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState<ApiErrorInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = can("integrations:manage");

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoading(true);
    setMoreError(null);
    try {
      const page = await bff<ItemList<Discrepancy>>(`${apiBase}/integrations/discrepancies`, {
        query: { status, ...(field ? { field } : {}), limit: DISCREPANCIES_PAGE, before: new Date(last.detectedAt).toISOString() },
      });
      setRows((cur) => [...cur, ...page.items]);
      setHasMore(page.items.length === DISCREPANCIES_PAGE);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setMoreError(err.toInfo());
    } finally {
      setLoading(false);
    }
  };

  const acknowledge = async (d: Discrepancy) => {
    setBusy(d.id);
    try {
      await bff<Discrepancy>(`${apiBase}/integrations/discrepancies/${d.id}/acknowledge`, { method: "POST" });
      setRows((cur) => cur.filter((x) => x.id !== d.id));
      toast({ tone: "success", title: t("integrations.discrepancies.acknowledged", { sku: d.sku }) });
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const value = (d: Discrepancy, v: string | null) => {
    if (v === null) return t("common.none");
    if (d.field === "price") return <Money amount={v} currency={store.defaultCurrency} />;
    return /^-?\d+$/.test(v) ? formatNumber(v, locale) : v;
  };

  const columns: Column<Discrepancy>[] = [
    { id: "sku", header: t("integrations.discrepancies.columns.sku"), cell: (d) => <span className="font-mono text-sm">{d.sku}</span> },
    { id: "field", header: t("integrations.discrepancies.columns.field"), cell: (d) => t.maybe(`integrations.discrepancies.fields.${d.field}`) ?? d.field },
    {
      id: "values",
      header: t("integrations.discrepancies.columns.values"),
      cell: (d) => (
        <ul className="flex flex-col gap-0.5 py-1">
          {d.values.map((v, i) => (
            <li key={`${v.source}-${i}`} className="flex items-center gap-1.5 text-sm">
              <span className={v.owner ? "font-medium text-fg" : "text-fg-muted"}>{v.label}:</span>
              <span className="tabular">{value(d, v.value)}</span>
              {v.owner ? (
                <span className="inline-flex items-center gap-0.5 text-xs text-accent-subtle-fg">
                  <Crown aria-hidden="true" className="size-3" />
                  {t("integrations.discrepancies.owner")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ),
    },
    { id: "status", header: t("integrations.discrepancies.columns.status"), cell: (d) => <StatusPill domain="discrepancy" value={d.status} /> },
    { id: "detected", header: t("integrations.discrepancies.columns.detected"), cell: (d) => <DateTime value={d.detectedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    { id: "checked", header: t("integrations.discrepancies.columns.checked"), cell: (d) => <DateTime value={d.resolvedAt ?? d.lastCheckedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    {
      id: "actions",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      cell: (d) =>
        canManage && d.status === "open" ? (
          <Button size="sm" onClick={() => void acknowledge(d)} loading={busy === d.id} disabled={busy !== null} aria-label={t("integrations.discrepancies.acknowledgeFor", { sku: d.sku })}>
            <CheckCheck aria-hidden="true" />
            {t("integrations.discrepancies.acknowledge")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("integrations.discrepancies.title")} meta={t("integrations.discrepancies.meta")} />
      <InlineAlert tone="info">{t("integrations.discrepancies.help")}</InlineAlert>
      <section aria-label={t("integrations.discrepancies.title")} className="min-w-0 rounded-lg border border-border bg-surface">
        <FilterTabs
          param="status"
          aria-label={t("integrations.discrepancies.statusTabs")}
          tabs={[
            { value: null, label: t("statuses.discrepancy.open") },
            { value: "acknowledged", label: t("statuses.discrepancy.acknowledged") },
            { value: "resolved", label: t("statuses.discrepancy.resolved") },
          ]}
        />
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
          <div className="w-full sm:w-56">
            <Select
              aria-label={t("integrations.discrepancies.fieldFilter")}
              value={field ?? "all"}
              onValueChange={(v) => setFilters({ field: v === "all" ? null : v })}
              options={[
                { value: "all", label: t("integrations.discrepancies.allFields") },
                { value: "stock", label: t("integrations.discrepancies.fields.stock") },
                { value: "price", label: t("integrations.discrepancies.fields.price") },
              ]}
            />
          </div>
        </div>
        <DataTable
          caption={t("integrations.discrepancies.title")}
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
          error={!result.ok ? <ErrorState error={result.error} /> : undefined}
          empty={
            field ? (
              <EmptyState title={t("states.emptyFilteredTitle")} description={t("states.emptyFilteredBody")} actions={<ButtonLink href={clearHref}>{t("states.clearFilters")}</ButtonLink>} />
            ) : (
              <EmptyState
                icon={Scale}
                title={status === "open" ? t("integrations.discrepancies.emptyOpen") : t("integrations.discrepancies.empty")}
                description={t("integrations.discrepancies.emptyBody")}
                actions={<ButtonLink href={`${basePath}/apps/ownership`}>{t("integrations.discrepancies.toOwnership")}</ButtonLink>}
              />
            )
          }
          footer={
            <>
              {moreError ? <ErrorState compact error={moreError} onRetry={() => void loadMore()} /> : null}
              <LoadMore hasMore={hasMore} loading={loading} onLoadMore={() => void loadMore()} />
            </>
          }
        />
      </section>
    </div>
  );
}
