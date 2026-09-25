"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import type { CollectionListItem } from "@/lib/commerce/types";
import { formatNumber } from "@/lib/format";

export function CollectionsView({ result }: { result: ApiResult<ItemList<CollectionListItem>> }) {
  const { t, locale } = useI18n();
  const { basePath, can } = useStore();
  const columns: Column<CollectionListItem>[] = [
    {
      id: "title",
      header: t("collections.columns.title"),
      sortValue: (c) => c.title,
      cell: (c) => (
        <span className="flex flex-col">
          <Link href={`${basePath}/products/collections/${c.id}`} className="font-medium text-fg">
            {c.title || c.handle}
          </Link>
          <span className="font-mono text-xs text-fg-subtle">/collections/{c.handle}</span>
        </span>
      ),
    },
    { id: "type", header: t("collections.columns.type"), sortValue: (c) => c.type, cell: (c) => <Badge tone={c.type === "automated" ? "accent" : "neutral"}>{t(`collections.types.${c.type}`)}</Badge> },
    {
      id: "published",
      header: t("collections.columns.visibility"),
      sortValue: (c) => (c.isPublished ? 1 : 0),
      cell: (c) => <Badge tone={c.isPublished ? "success" : "neutral"}>{c.isPublished ? t("collections.published") : t("collections.hidden")}</Badge>,
    },
    { id: "count", header: t("collections.columns.products"), align: "end", sortValue: (c) => c.productCount, cell: (c) => formatNumber(c.productCount, locale) },
    { id: "updated", header: t("collections.columns.updated"), sortValue: (c) => c.updatedAt, cell: (c) => <DateTime value={c.updatedAt} format="relative" className="text-fg-muted" /> },
  ];
  return (
    <section aria-label={t("collections.title")} className="min-w-0 rounded-lg border border-border bg-surface">
      {result.ok ? (
        <DataTable
          caption={t("collections.title")}
          columns={columns}
          rows={result.data.items}
          rowKey={(c) => c.id}
          sortable
          defaultSort={{ id: "title", direction: "asc" }}
          empty={
            <EmptyState
              icon={Layers}
              title={t("collections.empty.title")}
              description={t("collections.empty.body")}
              actions={
                can("catalog:write") ? (
                  <ButtonLink href={`${basePath}/products/collections/new`} variant="primary">
                    {t("collections.actions.new")}
                  </ButtonLink>
                ) : null
              }
            />
          }
        />
      ) : (
        <ErrorState error={result.error} />
      )}
    </section>
  );
}
