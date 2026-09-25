"use client";

import Link from "next/link";
import { FileUp } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StatusPill } from "@/components/ui/status-pill";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import type { ImportJob, ImportProfile } from "@/lib/commerce/types";
import { formatNumber } from "@/lib/format";

export function ImportsView({ jobs, profiles }: { jobs: ApiResult<ItemList<ImportJob>>; profiles: ImportProfile[] }) {
  const { t, locale } = useI18n();
  const { basePath, can } = useStore();
  const columns: Column<ImportJob>[] = [
    {
      id: "created",
      header: t("imports.columns.started"),
      cell: (j) => (
        <Link href={`${basePath}/products/imports/${j.id}`} className="whitespace-nowrap font-medium text-fg">
          <DateTime value={j.createdAt} />
        </Link>
      ),
    },
    { id: "format", header: t("imports.columns.format"), cell: (j) => <Badge className="uppercase">{j.format}</Badge> },
    { id: "status", header: t("imports.columns.status"), cell: (j) => <StatusPill domain="import" value={j.status} /> },
    { id: "rows", header: t("imports.columns.rows"), align: "end", cell: (j) => (j.totalRows !== null ? formatNumber(j.totalRows, locale) : t("common.none")) },
    { id: "created_count", header: t("imports.columns.created"), align: "end", cell: (j) => formatNumber(j.createdCount ?? 0, locale) },
    { id: "updated_count", header: t("imports.columns.updated"), align: "end", cell: (j) => formatNumber(j.updatedCount ?? 0, locale) },
    { id: "failed_count", header: t("imports.columns.failed"), align: "end", cell: (j) => <span className={(j.failedCount ?? 0) > 0 ? "text-danger" : undefined}>{formatNumber(j.failedCount ?? 0, locale)}</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t("imports.history")} className="min-w-0 rounded-lg border border-border bg-surface">
        {jobs.ok ? (
          <DataTable
            caption={t("imports.history")}
            columns={columns}
            rows={jobs.data.items}
            rowKey={(j) => j.id}
            empty={
              <EmptyState
                icon={FileUp}
                title={t("imports.empty.title")}
                description={t("imports.empty.body")}
                actions={
                  can("catalog:write") ? (
                    <ButtonLink href={`${basePath}/products/imports/new`} variant="primary">
                      {t("imports.actions.new")}
                    </ButtonLink>
                  ) : null
                }
              />
            }
            footer={jobs.data.items.length > 0 ? <p className="border-t border-border px-3 py-2 text-sm text-fg-subtle">{t("imports.historyNote")}</p> : null}
          />
        ) : (
          <ErrorState error={jobs.error} />
        )}
      </section>
      {profiles.length > 0 ? (
        <Card title={t("imports.profiles.title")} description={t("imports.profiles.description")}>
          <ul className="flex flex-col divide-y divide-border">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-base text-fg">{p.name}</span>
                <span className="flex items-center gap-2 text-sm text-fg-muted">
                  <Badge className="uppercase">{p.format}</Badge>
                  {t("imports.profiles.fields", { count: Object.keys(p.mapping).length })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
