import Link from "next/link";
import { AlertTriangle, PackageCheck } from "lucide-react";
import type { StoreContextValue } from "@/components/providers/store-provider";
import { Thumb } from "@/components/commerce/thumb";
import { DateTime } from "@/components/data/date-time";
import { Money } from "@/components/data/money";
import { Bps } from "@/components/data/percent";
import { Stat } from "@/components/data/stat";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { load } from "@/lib/api/load";
import type { CursorPage } from "@/lib/api/types";
import { mediaUrl, type MediaConfig } from "@/lib/commerce/media";
import { LOW_STOCK_THRESHOLD, WINDOW_DAYS, loadLowStock, loadOrderWindow } from "@/lib/commerce/overview-data";
import type { OrderListItem } from "@/lib/commerce/types";
import { cn } from "@/lib/cn";
import { formatMoney, formatNumber } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { DailyOrdersChart } from "./daily-orders-chart";

/** Skeleton of one overview card while its data loads (each card streams independently). */
export function CardSkeleton({ className, chart }: { className?: string; chart?: boolean }) {
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col gap-4 rounded-lg border border-border bg-surface p-4", className)}>
      <Skeleton className="h-4 w-40" />
      {chart ? <Skeleton className="h-32 w-full" /> : null}
      <SkeletonText lines={4} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders: last 30 days
// ---------------------------------------------------------------------------

export async function OrdersWindowCard({ ctx, className }: { ctx: StoreContextValue; className?: string }) {
  const { t, locale } = await getI18n();
  const result = await loadOrderWindow(ctx);
  const title = t("dashboard.orders.title", { days: WINDOW_DAYS });
  if (!result.ok) {
    return (
      <Card title={title} className={className}>
        <ErrorState error={result.error} compact />
      </Card>
    );
  }
  const w = result.data;
  const currency = ctx.store.defaultCurrency;
  const revenue = w.revenueByCurrency[currency] ?? "0";
  const paidInDefault = w.paidByCurrency[currency] ?? 0;
  const others = Object.entries(w.revenueByCurrency).filter(([c]) => c !== currency);
  const average = paidInDefault > 0 ? (BigInt(revenue) / BigInt(paidInDefault)).toString() : null;
  const lowerBound = w.truncated ? `${t("dashboard.orders.atLeast")} ` : "";
  return (
    <Card
      title={title}
      description={t("dashboard.orders.description")}
      className={className}
      actions={
        <Link href={`${ctx.basePath}/orders`} className="text-sm">
          {t("dashboard.viewAll")}
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label={t("dashboard.orders.paid")} value={`${lowerBound}${formatNumber(w.paidOrders, locale)}`} hint={t("dashboard.orders.placed", { count: formatNumber(w.placed, locale) })} />
          <Stat
            label={t("dashboard.orders.revenue")}
            value={<span className="[font-variant-numeric:normal]">{`${lowerBound}${formatMoney(revenue, currency, locale)}`}</span>}
            hint={others.length ? others.map(([c, v]) => formatMoney(v, c, locale)).join(" · ") : t("dashboard.orders.revenueHint")}
          />
          <Stat label={t("dashboard.orders.average")} value={average ? formatMoney(average, currency, locale) : t("common.none")} />
          <Stat
            label={t("dashboard.orders.toFulfill")}
            value={
              <Link href={`${ctx.basePath}/orders?status=confirmed`} className="text-fg no-underline hover:underline">
                {formatNumber(w.awaitingFulfillment, locale)}
              </Link>
            }
            hint={w.awaitingPayment > 0 ? t("dashboard.orders.awaitingPayment", { count: formatNumber(w.awaitingPayment, locale) }) : undefined}
          />
        </div>
        {w.placed === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-base text-fg-muted">{t("dashboard.orders.none")}</p>
        ) : (
          <DailyOrdersChart days={w.days} currency={currency} />
        )}
        {w.truncated ? <p className="text-xs text-warning">{t("dashboard.orders.truncated")}</p> : null}
      </div>
    </Card>
  );
}

export async function RecentOrdersCard({ ctx, className }: { ctx: StoreContextValue; className?: string }) {
  const { t, locale } = await getI18n();
  const result = await load<CursorPage<OrderListItem>>(`${ctx.apiBase}/orders`, { query: { limit: 8 } });
  return (
    <Card
      title={t("dashboard.recent.title")}
      className={className}
      flush
      actions={
        <Link href={`${ctx.basePath}/orders`} className="text-sm">
          {t("dashboard.viewAll")}
        </Link>
      }
    >
      {!result.ok ? (
        <ErrorState error={result.error} compact />
      ) : result.data.items.length === 0 ? (
        <p className="border-t border-border px-4 py-8 text-center text-base text-fg-muted">{t("dashboard.recent.empty")}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {result.data.items.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="flex min-w-0 flex-col">
                <Link href={`${ctx.basePath}/orders/${o.id}`} className="font-medium text-fg tabular">
                  #{o.number}
                </Link>
                <span className="truncate text-xs text-fg-subtle">
                  <DateTime value={o.createdAt} format="relative" /> · {o.email ?? t("common.none")} · {t("dashboard.recent.items", { count: formatNumber(o.itemCount, locale) })}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Money amount={o.total} currency={o.currency} className="text-sm font-medium" />
                <StatusPill domain="payment" value={o.paymentStatus} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------

export async function LowStockCard({ ctx, media, className }: { ctx: StoreContextValue; media: MediaConfig; className?: string }) {
  const { t, locale } = await getI18n();
  const result = await loadLowStock(ctx);
  const canInventory = ctx.permissions.includes("inventory:read");
  return (
    <Card
      title={t("dashboard.lowStock.title")}
      description={t("dashboard.lowStock.description", { threshold: LOW_STOCK_THRESHOLD })}
      className={className}
      flush
      actions={
        canInventory ? (
          <Link href={`${ctx.basePath}/inventory`} className="text-sm">
            {t("dashboard.lowStock.manage")}
          </Link>
        ) : null
      }
    >
      {!result.ok ? (
        <ErrorState error={result.error} compact />
      ) : result.data.scanned === 0 ? (
        <p className="border-t border-border px-4 py-8 text-center text-base text-fg-muted">{t("dashboard.lowStock.noProducts")}</p>
      ) : result.data.items.length === 0 ? (
        <p className="flex items-center justify-center gap-2 border-t border-border px-4 py-8 text-center text-base text-fg-muted">
          <PackageCheck aria-hidden="true" className="size-4 text-success" />
          {t("dashboard.lowStock.none")}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {result.data.items.slice(0, 8).map((i) => (
            <li key={`${i.productId}-${i.sku ?? i.variantTitle}`} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="flex min-w-0 items-center gap-3">
                <Thumb src={mediaUrl(media, i.imageObjectKey)} size={28} />
                <span className="flex min-w-0 flex-col">
                  <Link href={`${ctx.basePath}/products/${i.productId}`} className="truncate text-fg">
                    {i.productTitle || t("products.untitled")}
                  </Link>
                  <span className="truncate text-xs text-fg-subtle">{[i.variantTitle, i.sku].filter(Boolean).join(" · ")}</span>
                </span>
              </span>
              <Badge tone={i.available <= 0 ? "danger" : "warning"}>{i.available <= 0 ? t("dashboard.lowStock.out") : t("dashboard.lowStock.left", { count: formatNumber(i.available, locale) })}</Badge>
            </li>
          ))}
        </ul>
      )}
      {result.ok && result.data.partial ? (
        <p className="border-t border-border px-4 py-2 text-xs text-fg-subtle">{t("dashboard.lowStock.partial", { checked: formatNumber(result.data.checked, locale), scanned: formatNumber(result.data.scanned, locale) })}</p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Kârmatik and Yanıt (shown only while the link is active)
// ---------------------------------------------------------------------------

interface WireMoney {
  amount: string;
  currency: string;
}

interface KarmatikOverview {
  linked: boolean;
  circuit: { state?: string } | string | null;
  profit: { total: number; matched: number; lossMaking: number; thinMargin: number; missingCost: number; newest: string | null; lossMakingVariants: { ref: string; sku: string | null; marginBps: number | null; netProfit: WireMoney | null; variant: { productTitle: string | null; productId: string } | null }[] } | null;
  suggestions: { open: number; actionable: number } | null;
  alerts: { open: number; bySeverity: Record<string, number>; latest: { ref: string; severity: string; title: string; impactMonthly: WireMoney | null }[] } | null;
}

export async function KarmatikCard({ ctx, className }: { ctx: StoreContextValue; className?: string }) {
  const { t, locale } = await getI18n();
  const result = await load<KarmatikOverview>(`${ctx.apiBase}/ekosistem/karmatik/overview`);
  // Not connected: the card is not shown at all (connecting lives under Apps).
  if (result.ok && (!result.data.linked || !result.data.profit)) return null;
  const title = t("dashboard.karmatik.title");
  if (!result.ok) {
    return (
      <Card title={title} className={className}>
        <ErrorState error={result.error} compact />
      </Card>
    );
  }
  const { profit, alerts, suggestions } = result.data;
  return (
    <Card title={title} description={profit?.newest ? undefined : t("dashboard.karmatik.description")} className={className}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-4">
          <Stat label={t("dashboard.karmatik.lossMaking")} value={<span className={profit!.lossMaking > 0 ? "text-danger" : undefined}>{formatNumber(profit!.lossMaking, locale)}</span>} />
          <Stat label={t("dashboard.karmatik.thinMargin")} value={formatNumber(profit!.thinMargin, locale)} />
          <Stat label={t("dashboard.karmatik.missingCost")} value={formatNumber(profit!.missingCost, locale)} />
        </div>
        {profit!.lossMakingVariants.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {profit!.lossMakingVariants.slice(0, 3).map((v) => (
              <li key={v.ref} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <span className="truncate">{v.variant?.productTitle ?? v.sku ?? v.ref}</span>
                <span className="flex items-center gap-2">
                  {v.netProfit ? <Money amount={v.netProfit.amount} currency={v.netProfit.currency} /> : null}
                  <Bps value={v.marginBps} signed />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {alerts && alerts.open > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-sm font-medium text-fg">
              <AlertTriangle aria-hidden="true" className="size-4 text-warning" />
              {t("dashboard.karmatik.alerts", { count: formatNumber(alerts.open, locale) })}
            </span>
            <ul className="flex flex-col gap-1 text-sm">
              {alerts.latest.slice(0, 3).map((a) => (
                <li key={a.ref} className="flex items-center gap-2">
                  <StatusPill domain="alertSeverity" value={a.severity} noDot />
                  <span className="truncate">{a.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {suggestions ? <p className="text-sm text-fg-muted">{t("dashboard.karmatik.suggestions", { count: formatNumber(suggestions.actionable, locale) })}</p> : null}
        {profit!.newest ? (
          <p className="text-xs text-fg-subtle">
            {t("dashboard.freshness")} <DateTime value={profit!.newest} format="relative" />
          </p>
        ) : null}
      </div>
    </Card>
  );
}

interface YanitOverview {
  linked: boolean;
  visibility: { windowDays: number; latest: { visibilityBps: number | null; shareOfVoiceBps: number | null; asOf: string } | null; deltaBps: number | null }[] | null;
  gaps: { total: number; top: { ref: string; query: string; priority: number }[] } | null;
  opportunities: { open: number; drafted: number; top: { ref: string; title: string; impact: string }[] } | null;
}

export async function YanitCard({ ctx, className }: { ctx: StoreContextValue; className?: string }) {
  const { t, locale } = await getI18n();
  const result = await load<YanitOverview>(`${ctx.apiBase}/ekosistem/yanit/overview`);
  if (result.ok && (!result.data.linked || !result.data.visibility)) return null;
  const title = t("dashboard.yanit.title");
  if (!result.ok) {
    return (
      <Card title={title} className={className}>
        <ErrorState error={result.error} compact />
      </Card>
    );
  }
  const { visibility, gaps, opportunities } = result.data;
  const asOf = visibility?.find((v) => v.latest)?.latest?.asOf ?? null;
  return (
    <Card title={title} description={t("dashboard.yanit.description")} className={className}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {(visibility ?? []).map((v) => (
            <Stat
              key={v.windowDays}
              label={t("dashboard.yanit.visibility", { days: v.windowDays })}
              value={<Bps value={v.latest?.visibilityBps ?? null} />}
              {...(v.deltaBps !== null ? { delta: <Bps value={v.deltaBps} signed /> } : {})}
            />
          ))}
          <Stat label={t("dashboard.yanit.opportunities")} value={formatNumber(opportunities?.open ?? 0, locale)} hint={t("dashboard.yanit.gaps", { count: formatNumber(gaps?.total ?? 0, locale) })} />
        </div>
        {gaps && gaps.top.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">{t("dashboard.yanit.topGaps")}</span>
            <ul className="flex flex-col gap-1 text-sm text-fg-muted">
              {gaps.top.slice(0, 3).map((g) => (
                <li key={g.ref} className="truncate">
                  “{g.query}”
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {asOf ? (
          <p className="text-xs text-fg-subtle">
            {t("dashboard.freshness")} <DateTime value={asOf} format="relative" />
          </p>
        ) : null}
      </div>
    </Card>
  );
}
