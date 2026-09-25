"use client";

import Link from "next/link";
import { ExternalLink, PlugZap } from "lucide-react";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { ApiResult } from "@/lib/api/server";
import type { ItemList } from "@/lib/api/types";
import type { IntegrationConnection, IntegrationProvider } from "@/lib/integrations/types";
import { formatNumber } from "@/lib/format";
import { CapabilityList, KindBadge, useProviderName } from "./shared";

function ProviderCard({ provider, canManage }: { provider: IntegrationProvider; canManage: boolean }) {
  const { t, locale } = useI18n();
  const { basePath } = useStore();
  const providerName = useProviderName();
  const name = providerName(provider.id, provider.name);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-md font-semibold text-fg">{name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <KindBadge kind={provider.kind} />
            <Badge>{t("integrations.catalog.poll", { minutes: formatNumber(provider.defaultPollMinutes, locale) })}</Badge>
          </div>
        </div>
        {canManage && provider.available ? (
          <ButtonLink size="sm" variant="primary" href={`${basePath}/apps/connect/${provider.id}`} aria-label={t("integrations.catalog.connectTo", { name })}>
            {t("integrations.catalog.connect")}
          </ButtonLink>
        ) : null}
      </div>
      <CapabilityList capabilities={provider.capabilities} />
      {provider.docs.notes.length ? (
        <details className="group text-sm">
          <summary className="cursor-pointer self-start rounded-sm font-medium text-fg-muted hover:text-fg">{t("integrations.catalog.notes")}</summary>
          {locale !== "tr" ? <p className="mt-1 text-xs text-fg-subtle">{t("integrations.catalog.notesLanguage")}</p> : null}
          <ul lang="tr" className="mt-1.5 flex list-disc flex-col gap-1 ps-4 text-fg-muted">
            {provider.docs.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/**
 * Apps & Integrations › Connections: the store's integrator, marketplace and feed connections,
 * and the connector catalog from GET /v1/integrations/providers.
 */
export function AppsOverview({ connections, providers }: { connections: ApiResult<ItemList<IntegrationConnection>>; providers: ApiResult<ItemList<IntegrationProvider>> }) {
  const { t, locale } = useI18n();
  const { basePath, can } = useStore();
  const canManage = can("integrations:manage");
  const providerName = useProviderName();
  const available = providers.ok ? providers.data.items.filter((p) => p.available) : [];
  const pending = providers.ok ? providers.data.items.filter((p) => !p.available) : [];

  const columns: Column<IntegrationConnection>[] = [
    {
      id: "name",
      header: t("integrations.columns.name"),
      sortValue: (c) => c.name,
      cell: (c) => (
        <Link href={`${basePath}/apps/connections/${c.id}`} className="font-medium text-fg">
          {c.name}
        </Link>
      ),
    },
    { id: "provider", header: t("integrations.columns.provider"), sortValue: (c) => providerName(c.provider, c.providerName), cell: (c) => providerName(c.provider, c.providerName) },
    { id: "kind", header: t("integrations.columns.kind"), cell: (c) => <KindBadge kind={c.kind} /> },
    { id: "status", header: t("integrations.columns.status"), sortValue: (c) => c.status, cell: (c) => <StatusPill domain="integrationConnection" value={c.status} /> },
    {
      id: "lastSync",
      header: t("integrations.columns.lastSuccess"),
      sortValue: (c) => c.lastSuccessAt ?? "",
      cell: (c) => (c.lastSuccessAt ? <DateTime value={c.lastSuccessAt} format="relative" className="whitespace-nowrap text-fg-muted" /> : <span className="text-fg-subtle">{t("integrations.never")}</span>),
    },
    {
      id: "health",
      header: t("integrations.columns.health"),
      cell: (c) =>
        c.lastError ? (
          <span className="block max-w-72 truncate text-sm text-danger" title={c.lastError}>
            {c.consecutiveFailures > 0 ? t("integrations.failures", { count: formatNumber(c.consecutiveFailures, locale) }) : null} {c.lastError}
          </span>
        ) : (
          <span className="text-sm text-fg-muted">{t("integrations.healthy")}</span>
        ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={t("integrations.title")} meta={t("integrations.meta")} />
      <Card flush title={t("integrations.connectionsTitle")} description={t("integrations.connectionsDescription")}>
        <DataTable
          caption={t("integrations.connectionsTitle")}
          columns={columns}
          rows={connections.ok ? connections.data.items : []}
          rowKey={(c) => c.id}
          sortable
          error={!connections.ok ? <ErrorState error={connections.error} /> : undefined}
          empty={
            <EmptyState
              icon={PlugZap}
              title={t("integrations.emptyTitle")}
              description={canManage ? t("integrations.emptyBody") : t("integrations.emptyReadOnly")}
            />
          }
        />
      </Card>

      <section aria-labelledby="catalog-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="catalog-title" className="text-lg font-semibold text-fg">
            {t("integrations.catalog.title")}
          </h2>
          <p className="text-sm text-fg-muted">{canManage ? t("integrations.catalog.description") : t("integrations.catalog.readOnly")}</p>
        </div>
        {!providers.ok ? (
          <div className="rounded-lg border border-border bg-surface">
            <ErrorState error={providers.error} compact />
          </div>
        ) : (
          <>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {available.map((p) => (
                <ProviderCard key={p.id} provider={p} canManage={canManage} />
              ))}
            </ul>
            {pending.length ? (
              <details className="rounded-lg border border-border bg-surface">
                <summary className="cursor-pointer px-4 py-3 text-base font-medium text-fg">{t("integrations.catalog.pending", { count: pending.length })}</summary>
                <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
                  <p className="text-sm text-fg-muted">{t("integrations.catalog.pendingHelp")}</p>
                  <ul className="flex flex-col gap-3">
                    {pending.map((p) => (
                      <li key={p.id} className="flex flex-col gap-1">
                        <span className="flex items-center gap-2 font-medium text-fg">
                          {providerName(p.id, p.name)} <KindBadge kind={p.kind} />
                        </span>
                        <ul lang="tr" className="list-disc ps-4 text-sm text-fg-muted">
                          {p.docs.notes.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                        {p.docs.sources[0]?.startsWith("https://") ? (
                          <a href={p.docs.sources[0]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-sm">
                            {t("integrations.catalog.docs")}
                            <ExternalLink aria-hidden="true" className="size-3.5" />
                            <span className="sr-only"> ({t("common.openInNewTab")})</span>
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
