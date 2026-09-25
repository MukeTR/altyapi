"use client";

import { FileText, SearchX } from "lucide-react";
import Link from "next/link";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { SearchField } from "@/components/commerce/search-field";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { CursorPagination } from "@/components/data/pagination";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StatusPill } from "@/components/ui/status-pill";
import type { ApiResult } from "@/lib/api/server";
import type { CursorPage } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { entryPath, labelText } from "@/lib/content/fields";
import type { ContentTypeDetail, EntryListItem } from "@/lib/content/types";
import { localeLabel } from "@/lib/locales";
import { useRecordLabels } from "./record-pickers";

/** Short text of a list column value (titles of referenced entries, yes/no, dates). */
function ColumnValue({ type, field, value }: { type: ContentTypeDetail; field: string; value: unknown }) {
  const { t, locale } = useI18n();
  const def = type.fields.find((f) => f.key === field);
  const ids = def?.type === "multiReference" && def.validation.to === "entry" && Array.isArray(value) ? (value as string[]) : def?.type === "reference" && def.validation.to === "entry" && typeof value === "string" ? [value] : [];
  const labels = useRecordLabels("entry", ids);
  if (value === null || value === undefined || value === "") return <span className="text-fg-subtle">{t("common.none")}</span>;
  if (ids.length) return <span className="truncate">{ids.map((id) => labels(id)?.label ?? "…").join(", ")}</span>;
  if (typeof value === "boolean") return value ? <Badge tone="accent">{t("common.yes")}</Badge> : <span className="text-fg-subtle">{t("common.no")}</span>;
  if (def?.type === "select") return <span>{labelText(def.validation.options?.find((o) => o.value === value)?.label, locale, String(value))}</span>;
  if (typeof value === "string" || typeof value === "number") return <span className="truncate">{String(value)}</span>;
  return <span className="text-fg-subtle">…</span>;
}

/**
 * Content › entries of a type: status tabs, title search, keyset pagination, per-language
 * completeness (live, draft slug, missing) and the type's list columns.
 */
export function EntriesView({ type, result, filtered }: { type: ContentTypeDetail; result: ApiResult<CursorPage<EntryListItem>>; filtered: boolean }) {
  const { t, locale } = useI18n();
  const { basePath, store, can } = useStore();
  const { params, pending, clearHref } = useUrlFilters();
  const locales = [store.defaultLocale, ...store.supportedLocales.filter((l) => l !== store.defaultLocale)];
  const listColumns = type.fields.filter((f) => f.listColumn && !f.hidden && f.key !== type.titleField);
  const href = (id: string) => `${basePath}/content/${encodeURIComponent(type.key)}/${id}`;
  const canCreate = can("content:write") && type.status === "active";
  const counts = type.entryCounts ?? {};

  const columns: Column<EntryListItem>[] = [
    {
      id: "title",
      header: t("content.entries.columns.title"),
      cell: (e) => {
        const path = entryPath({ routePrefix: type.routePrefix, kind: type.kind }, store.defaultLocale, store.defaultLocale, e.slugs[store.defaultLocale]);
        return (
          <span className="flex min-w-0 flex-col">
            <Link href={href(e.id)} className="truncate font-medium text-fg">
              {e.title || t("content.entries.untitled")}
            </Link>
            {path ? <span className="truncate font-mono text-xs text-fg-subtle">{path}</span> : null}
          </span>
        );
      },
    },
    {
      id: "status",
      header: t("content.entries.columns.status"),
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill domain="contentEntry" value={e.status} />
          {e.status === "published" && e.hasUnpublishedChanges ? <Badge tone="warning">{t("content.entries.unpublishedChanges")}</Badge> : null}
        </span>
      ),
    },
    {
      id: "locales",
      header: t("content.entries.columns.languages"),
      cell: (e) => (
        <ul className="flex flex-wrap gap-1" aria-label={t("content.entries.columns.languages")}>
          {locales.map((l) => {
            const live = e.publishedLocales.includes(l);
            const drafted = Boolean(e.slugs[l]) || !type.hasSlugs;
            const state = live ? "live" : drafted ? "draft" : "missing";
            return (
              <li
                key={l}
                title={`${localeLabel(l, locale)}: ${t(`content.entries.localeStates.${state}`)}`}
                className={cn(
                  "rounded-sm border px-1 text-xs font-medium uppercase",
                  live ? "border-transparent bg-success-bg text-success" : drafted ? "border-border text-fg-muted" : "border-dashed border-border text-fg-subtle",
                )}
              >
                <span aria-hidden="true">{l}</span>
                <span className="sr-only">
                  {localeLabel(l, locale)}: {t(`content.entries.localeStates.${state}`)}
                </span>
              </li>
            );
          })}
        </ul>
      ),
    },
    ...listColumns.slice(0, 3).map(
      (f): Column<EntryListItem> => ({
        id: `col-${f.key}`,
        header: labelText(f.label, locale, f.key),
        cell: (e) => <ColumnValue type={type} field={f.key} value={e.columns[f.key]} />,
      }),
    ),
    {
      id: "schedule",
      header: t("content.entries.columns.schedule"),
      cell: (e) =>
        e.publishAt ? (
          <span className="whitespace-nowrap text-sm">
            {t("content.entries.publishesAt")} <DateTime value={e.publishAt} format="datetime" />
          </span>
        ) : e.unpublishAt ? (
          <span className="whitespace-nowrap text-sm">
            {t("content.entries.unpublishesAt")} <DateTime value={e.unpublishAt} format="datetime" />
          </span>
        ) : (
          <span className="text-fg-subtle">{t("common.none")}</span>
        ),
    },
    { id: "updated", header: t("content.entries.columns.updated"), cell: (e) => <DateTime value={e.updatedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
  ];

  const tab = (status: string | null, label: string) => ({ value: status, label: status && counts[status as keyof typeof counts] ? `${label} (${counts[status as keyof typeof counts]})` : label });

  return (
    <section aria-label={labelText(type.labels.namePlural, locale, type.key)} className="min-w-0 rounded-lg border border-border bg-surface">
      <FilterTabs
        param="status"
        aria-label={t("content.entries.tabsLabel")}
        tabs={[tab(null, t("content.entries.tabs.all")), tab("draft", t("statuses.contentEntry.draft")), tab("scheduled", t("statuses.contentEntry.scheduled")), tab("published", t("statuses.contentEntry.published")), tab("archived", t("statuses.contentEntry.archived"))]}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <SearchField label={t("content.entries.search")} className="w-full sm:w-80" />
        {filtered ? (
          <ButtonLink href={clearHref} variant="ghost" className="ms-auto">
            {t("commerce.filters.clear")}
          </ButtonLink>
        ) : null}
      </div>
      <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
        {result.ok ? (
          <DataTable
            caption={labelText(type.labels.namePlural, locale, type.key)}
            columns={columns}
            rows={result.data.items}
            rowKey={(e) => e.id}
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
                  icon={FileText}
                  title={t("content.entries.emptyTitle", { name: labelText(type.labels.namePlural, locale, type.key) })}
                  description={t("content.entries.emptyBody")}
                  actions={
                    canCreate ? (
                      <ButtonLink href={`${basePath}/content/${encodeURIComponent(type.key)}/new`} variant="primary">
                        {t("content.entries.new", { name: labelText(type.labels.name, locale, type.key) })}
                      </ButtonLink>
                    ) : null
                  }
                />
              )
            }
            footer={result.data.nextCursor || params.get("cursor") ? <CursorPagination nextCursor={result.data.nextCursor} orderLabel={t("content.entries.order")} /> : null}
          />
        ) : (
          <ErrorState error={result.error} />
        )}
      </div>
    </section>
  );
}
