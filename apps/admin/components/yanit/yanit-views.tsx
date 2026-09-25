"use client";

import Link from "next/link";
import { ExternalLink, FilePlus2, FileText, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { FilterTabs } from "@/components/commerce/filter-tabs";
import { useUrlFilters } from "@/components/commerce/use-url-filters";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { OffsetPagination } from "@/components/data/pagination";
import { Bps } from "@/components/data/percent";
import { Stat } from "@/components/data/stat";
import { FreshnessCard, NotLinked, PeerListError } from "@/components/ekosistem/peer-status";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiResult } from "@/lib/api/server";
import type { OffsetPage } from "@/lib/api/types";
import type { DraftResult, VisibilityWindow, YanitCitation, YanitGap, YanitOpportunity, YanitOverview as Overview } from "@/lib/ekosistem/types";
import { formatNumber } from "@/lib/format";

const IMPACT_TONE: Record<string, Tone> = { high: "danger", medium: "warning", low: "neutral" };

function ImpactBadge({ impact }: { impact: string }) {
  const { t } = useI18n();
  return <Badge tone={IMPACT_TONE[impact] ?? "neutral"}>{t.maybe(`yanit.impact.${impact}`) ?? impact}</Badge>;
}

function Shell({ title, meta, children, breadcrumb = true }: { title: string; meta: string; children: ReactNode; breadcrumb?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <PageHeader title={title} meta={meta} {...(breadcrumb ? { breadcrumbs: [{ label: t("yanit.title") }] } : {})} />
      {children}
    </div>
  );
}

function VisibilityCard({ w }: { w: VisibilityWindow }) {
  const { t, locale } = useI18n();
  const v = w.latest;
  return (
    <Card title={t("yanit.overview.windowTitle", { days: w.windowDays })}>
      {v ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-4">
            <Stat label={t("yanit.overview.visibility")} value={<Bps value={v.visibilityBps} />} delta={w.deltaBps !== null ? <Bps value={w.deltaBps} signed /> : undefined} hint={t("yanit.overview.visibilityHint")} />
            <Stat label={t("yanit.overview.shareOfVoice")} value={<Bps value={v.shareOfVoiceBps} />} hint={t("yanit.overview.shareHint")} />
          </div>
          <p className="text-xs text-fg-subtle">
            {v.validRuns !== null ? t("yanit.overview.runs", { runs: formatNumber(v.validRuns, locale), brand: formatNumber(v.runsWithBrand ?? 0, locale) }) : null}{" "}
            {v.lastMeasuredAt ? (
              <>
                · {t("yanit.overview.measured")} <DateTime value={v.lastMeasuredAt} format="relative" />
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t("yanit.overview.noMeasurement")}</p>
      )}
    </Card>
  );
}

/** Yanıt › Visibility: AI-answer visibility for 7 and 30 days, top gaps, opportunities and citations. */
export function YanitOverview({ result }: { result: ApiResult<Overview> }) {
  const { t, locale } = useI18n();
  const { basePath } = useStore();
  if (!result.ok) {
    return (
      <Shell title={t("yanit.title")} meta={t("yanit.meta")} breadcrumb={false}>
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState error={result.error} />
        </div>
      </Shell>
    );
  }
  const o = result.data;
  if (!o.linked) {
    return (
      <Shell title={t("yanit.title")} meta={t("yanit.meta")} breadcrumb={false}>
        <NotLinked peer="yanit" link={o.link} configured={o.configured} />
      </Shell>
    );
  }
  const n = (v: number) => formatNumber(v, locale);
  return (
    <Shell title={t("yanit.title")} meta={t("yanit.meta")} breadcrumb={false}>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
          {(o.visibility ?? []).map((w) => (
            <VisibilityCard key={w.windowDays} w={w} />
          ))}
        </div>
        <FreshnessCard freshness={o.freshness} circuit={o.circuit} nextPullAt={o.nextPullAt} className="lg:col-span-4" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title={t("yanit.overview.gapsTitle")}
          description={t("yanit.overview.gapsCount", { count: n(o.gaps?.total ?? 0) })}
          actions={
            <Link href={`${basePath}/yanit/gaps`} className="text-sm">
              {t("yanit.overview.viewAll")}
            </Link>
          }
        >
          {o.gaps?.top.length ? (
            <ul className="flex flex-col gap-2">
              {o.gaps.top.slice(0, 5).map((g) => (
                <li key={g.ref} className="flex flex-col">
                  <span className="text-base text-fg">{g.query}</span>
                  {g.competitorsMentioned.length ? <span className="text-xs text-fg-muted">{t("yanit.gaps.competitorsShort", { names: g.competitorsMentioned.slice(0, 3).join(", ") })}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">{t("yanit.overview.noGaps")}</p>
          )}
        </Card>
        <Card
          title={t("yanit.overview.opportunitiesTitle")}
          description={o.opportunities ? t("yanit.overview.opportunitiesCount", { open: n(o.opportunities.open), drafted: n(o.opportunities.drafted) }) : undefined}
          actions={
            <Link href={`${basePath}/yanit/opportunities`} className="text-sm">
              {t("yanit.overview.viewAll")}
            </Link>
          }
        >
          {o.opportunities?.top.length ? (
            <ul className="flex flex-col gap-2">
              {o.opportunities.top.slice(0, 5).map((op) => (
                <li key={op.ref} className="flex items-start justify-between gap-2">
                  <span className="text-base text-fg">{op.title}</span>
                  <ImpactBadge impact={op.impact} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">{t("yanit.overview.noOpportunities")}</p>
          )}
        </Card>
        <Card
          title={t("yanit.overview.citationsTitle")}
          description={o.citations ? t("yanit.overview.citationsCount", { count: n(o.citations.domains) }) : undefined}
          actions={
            <Link href={`${basePath}/yanit/citations`} className="text-sm">
              {t("yanit.overview.viewAll")}
            </Link>
          }
        >
          {o.citations?.top.length ? (
            <ul className="flex flex-col gap-2">
              {o.citations.top.slice(0, 5).map((c) => (
                <li key={c.domain} className="flex items-center justify-between gap-2 text-base">
                  <span className="truncate font-mono text-sm text-fg">{c.domain}</span>
                  <span className="text-sm text-fg-muted tabular">{n(c.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">{t("yanit.overview.noCitations")}</p>
          )}
        </Card>
      </div>
    </Shell>
  );
}

function ListBody<T>({ title, result, columns, rowKey, tabs, filters, filtered, emptyTitle, emptyBody }: {
  title: string;
  result: ApiResult<OffsetPage<T>>;
  columns: Column<T>[];
  rowKey: (r: T) => string;
  tabs?: ReactNode;
  filters?: ReactNode;
  filtered: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  const { t } = useI18n();
  const { clearHref } = useUrlFilters();
  if (!result.ok) return <PeerListError peer="yanit" error={result.error} />;
  return (
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
  );
}

const INTENTS = ["discovery", "comparison", "review", "how_to"] as const;

/** Yanıt › Visibility gaps: questions where AI answers mention competitors but not this brand. */
export function YanitGaps({ result, filtered }: { result: ApiResult<OffsetPage<YanitGap>>; filtered: boolean }) {
  const { t, locale } = useI18n();
  const columns: Column<YanitGap>[] = [
    { id: "query", header: t("yanit.gaps.columns.query"), cell: (g) => <span className="block max-w-lg text-fg">{g.query}</span> },
    { id: "intent", header: t("yanit.gaps.columns.intent"), cell: (g) => (g.intent ? <Badge>{t.maybe(`yanit.intents.${g.intent}`) ?? g.intent}</Badge> : t("common.none")) },
    { id: "priority", header: t("yanit.gaps.columns.priority"), align: "end", cell: (g) => (g.priority === null ? t("common.none") : formatNumber(g.priority, locale)) },
    { id: "competitors", header: t("yanit.gaps.columns.competitors"), cell: (g) => <span className="block max-w-64 truncate text-sm text-fg-muted" title={g.competitorsMentioned.join(", ")}>{g.competitorsMentioned.join(", ") || t("common.none")}</span> },
    { id: "providers", header: t("yanit.gaps.columns.providers"), cell: (g) => <span className="flex flex-wrap gap-1">{g.providers.map((p) => <Badge key={p}>{p}</Badge>)}</span> },
    { id: "lastRun", header: t("yanit.gaps.columns.lastRun"), cell: (g) => <DateTime value={g.lastRunAt ?? g.asOf} format="relative" className="whitespace-nowrap text-fg-muted" /> },
  ];
  return (
    <Shell title={t("yanit.gaps.title")} meta={t("yanit.gaps.meta")}>
      <ListBody
        title={t("yanit.gaps.title")}
        result={result}
        columns={columns}
        rowKey={(g) => g.ref}
        filtered={filtered}
        emptyTitle={t("yanit.gaps.emptyTitle")}
        emptyBody={t("yanit.gaps.emptyBody")}
        tabs={<FilterTabs param="intent" aria-label={t("yanit.gaps.columns.intent")} tabs={[{ value: null, label: t("yanit.all") }, ...INTENTS.map((i) => ({ value: i, label: t(`yanit.intents.${i}`) }))]} />}
      />
    </Shell>
  );
}

const KINDS = ["faq", "comparison_page", "structured_data", "product_content", "other"] as const;

/**
 * Yanıt › Content opportunities: create a draft page from an opportunity (never published
 * automatically; it opens in the storefront editor) or dismiss it here.
 */
export function YanitOpportunities({ result, filtered }: { result: ApiResult<OffsetPage<YanitOpportunity>>; filtered: boolean }) {
  const { t } = useI18n();
  const { apiBase, basePath, can } = useStore();
  const router = useRouter();
  const { params, setFilters } = useUrlFilters();
  const { toast, toastError } = useToast();
  const [, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<YanitOpportunity | null>(null);
  const canWrite = can("content:write");

  const draft = async (o: YanitOpportunity) => {
    setBusy(o.ref);
    try {
      const res = await bff<DraftResult>(`${apiBase}/ekosistem/yanit/opportunities/${encodeURIComponent(o.ref)}/draft`, { method: "POST" });
      toast({ tone: "success", title: res.created ? t("yanit.opportunities.drafted") : t("yanit.opportunities.draftExists") });
      router.push(`${basePath}/storefront/editor?page=${res.page.id}`);
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
      setBusy(null);
    }
  };

  const dismiss = async () => {
    if (!dismissing) return;
    setBusy(dismissing.ref);
    try {
      await bff(`${apiBase}/ekosistem/yanit/opportunities/${encodeURIComponent(dismissing.ref)}/dismiss`, { method: "POST" });
      toast({ tone: "success", title: t("yanit.opportunities.dismissed") });
      setDismissing(null);
      startRefresh(() => router.refresh());
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<YanitOpportunity>[] = [
    {
      id: "title",
      header: t("yanit.opportunities.columns.title"),
      cell: (o) => (
        <span className="flex max-w-xl flex-col gap-0.5 py-1">
          <span className="font-medium text-fg">{o.title}</span>
          {o.query ? <span className="text-sm text-fg-muted">“{o.query}”</span> : null}
          <span className="line-clamp-2 text-sm text-fg-muted">{o.body}</span>
          {o.targetUrl && /^https?:\/\//.test(o.targetUrl) ? (
            <a href={o.targetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-sm">
              {t("yanit.opportunities.target")}
              <ExternalLink aria-hidden="true" className="size-3.5" />
              <span className="sr-only"> ({t("common.openInNewTab")})</span>
            </a>
          ) : null}
        </span>
      ),
    },
    { id: "kind", header: t("yanit.opportunities.columns.kind"), cell: (o) => <Badge>{t.maybe(`yanit.kinds.${o.kind}`) ?? o.kind}</Badge> },
    { id: "impact", header: t("yanit.opportunities.columns.impact"), cell: (o) => <ImpactBadge impact={o.impact} /> },
    { id: "status", header: t("yanit.opportunities.columns.status"), cell: (o) => <StatusPill domain="opportunity" value={o.status} /> },
    { id: "updated", header: t("yanit.opportunities.columns.updated"), cell: (o) => <DateTime value={o.updatedAt ?? o.createdAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    {
      id: "actions",
      header: t("common.actions"),
      srOnlyHeader: true,
      align: "end",
      cell: (o) => {
        if (o.status === "drafted" && o.draftPageId) {
          return (
            <ButtonLink size="sm" href={`${basePath}/storefront/editor?page=${o.draftPageId}`}>
              <FileText aria-hidden="true" />
              {t("yanit.opportunities.openDraft")}
            </ButtonLink>
          );
        }
        if (o.status !== "new") return null;
        const buttons = (
          <span className="inline-flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!canWrite || busy !== null} loading={busy === o.ref} onClick={() => void draft(o)} aria-label={t("yanit.opportunities.draftFor", { title: o.title })}>
              <FilePlus2 aria-hidden="true" />
              {t("yanit.opportunities.draft")}
            </Button>
            <Button size="sm" disabled={!canWrite || busy !== null} onClick={() => setDismissing(o)} aria-label={t("yanit.opportunities.dismissFor", { title: o.title })}>
              <X aria-hidden="true" />
            </Button>
          </span>
        );
        return canWrite ? (
          buttons
        ) : (
          <Tooltip content={t("yanit.opportunities.needContent")}>
            <span tabIndex={0} className="inline-flex">
              {buttons}
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Shell title={t("yanit.opportunities.title")} meta={t("yanit.opportunities.meta")}>
      <ListBody
        title={t("yanit.opportunities.title")}
        result={result}
        columns={columns}
        rowKey={(o) => o.ref}
        filtered={filtered}
        emptyTitle={t("yanit.opportunities.emptyTitle")}
        emptyBody={t("yanit.opportunities.emptyBody")}
        tabs={
          <FilterTabs
            param="status"
            aria-label={t("yanit.opportunities.columns.status")}
            tabs={[
              { value: null, label: t("statuses.opportunity.new") },
              { value: "drafted", label: t("statuses.opportunity.drafted") },
              { value: "dismissed", label: t("statuses.opportunity.dismissed") },
              { value: "any", label: t("yanit.all") },
            ]}
          />
        }
        filters={
          <>
            <div className="w-full sm:w-56">
              <Select
                aria-label={t("yanit.opportunities.columns.kind")}
                value={params.get("kind") ?? "all"}
                onValueChange={(v) => setFilters({ kind: v === "all" ? null : v })}
                options={[{ value: "all", label: t("yanit.opportunities.allKinds") }, ...KINDS.map((k) => ({ value: k, label: t(`yanit.kinds.${k}`) }))]}
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                aria-label={t("yanit.opportunities.columns.impact")}
                value={params.get("impact") ?? "all"}
                onValueChange={(v) => setFilters({ impact: v === "all" ? null : v })}
                options={[{ value: "all", label: t("yanit.opportunities.allImpacts") }, ...(["high", "medium", "low"] as const).map((i) => ({ value: i, label: t(`yanit.impact.${i}`) }))]}
              />
            </div>
          </>
        }
      />
      <p className="text-sm text-fg-muted">{t("yanit.opportunities.draftNote")}</p>
      <AlertDialog
        open={dismissing !== null}
        onOpenChange={(o) => !o && setDismissing(null)}
        tone="primary"
        title={t("yanit.opportunities.dismissTitle")}
        description={t("yanit.opportunities.dismissBody")}
        confirmLabel={t("yanit.opportunities.dismiss")}
        pending={busy !== null}
        onConfirm={() => void dismiss()}
      />
    </Shell>
  );
}

/** Yanıt › Citations: domains AI answers cite for the brand's questions (30 days). */
export function YanitCitations({ result }: { result: ApiResult<OffsetPage<YanitCitation>> }) {
  const { t, locale } = useI18n();
  const columns: Column<YanitCitation>[] = [
    { id: "domain", header: t("yanit.citations.columns.domain"), cell: (c) => <span className="font-mono text-sm text-fg">{c.domain}</span> },
    { id: "count", header: t("yanit.citations.columns.count"), align: "end", cell: (c) => formatNumber(c.count, locale) },
    { id: "share", header: t("yanit.citations.columns.share"), align: "end", cell: (c) => <Bps value={c.shareBps} /> },
    {
      id: "samples",
      header: t("yanit.citations.columns.samples"),
      cell: (c) => (
        <ul className="flex flex-col gap-0.5">
          {c.sampleUrls.slice(0, 3).filter((u) => /^https?:\/\//.test(u)).map((u) => (
            <li key={u}>
              <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-96 truncate text-sm">
                {u}
                <span className="sr-only"> ({t("common.openInNewTab")})</span>
              </a>
            </li>
          ))}
        </ul>
      ),
    },
    { id: "asOf", header: t("yanit.citations.columns.asOf"), cell: (c) => <DateTime value={c.asOf} format="relative" className="whitespace-nowrap text-fg-muted" /> },
  ];
  return (
    <Shell title={t("yanit.citations.title")} meta={t("yanit.citations.meta")}>
      <ListBody title={t("yanit.citations.title")} result={result} columns={columns} rowKey={(c) => c.domain} filtered={false} emptyTitle={t("yanit.citations.emptyTitle")} emptyBody={t("yanit.citations.emptyBody")} />
    </Shell>
  );
}
