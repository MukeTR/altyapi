"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { buttonClasses } from "@/components/ui/button-styles";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

const disabledLink = "pointer-events-none opacity-55";

function href(pathname: string, params: URLSearchParams): string {
  const s = params.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/**
 * Keyset pagination (products, orders): the API returns only `nextCursor`, so "previous" is a
 * stack of earlier cursors kept in ?prev= (comma separated). Shows the fixed server order instead
 * of totals, which the API does not provide.
 */
export function CursorPagination({ nextCursor, orderLabel }: { nextCursor: string | null; orderLabel?: string }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const cursor = params.get("cursor");
  const prevStack = (params.get("prev") ?? "").split(",").filter(Boolean);

  const nextParams = new URLSearchParams(params.toString());
  if (nextCursor) {
    nextParams.set("cursor", nextCursor);
    nextParams.set("prev", [...prevStack, cursor ?? ""].join(","));
    if (!cursor && prevStack.length === 0) nextParams.set("prev", "_");
  }
  const prevParams = new URLSearchParams(params.toString());
  const stack = [...prevStack];
  const previous = stack.pop();
  if (previous && previous !== "_") prevParams.set("cursor", previous);
  else prevParams.delete("cursor");
  if (stack.length > 0) prevParams.set("prev", stack.join(","));
  else prevParams.delete("prev");
  const hasPrevious = Boolean(cursor);

  return (
    <nav aria-label={t("ui.table.pagination")} className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
      <span className="text-sm text-fg-subtle">{orderLabel ?? t("ui.table.newestFirst")}</span>
      <div className="flex items-center gap-2">
        <Link
          href={href(pathname, prevParams)}
          aria-disabled={!hasPrevious || undefined}
          tabIndex={hasPrevious ? undefined : -1}
          className={buttonClasses("secondary", "sm", hasPrevious ? undefined : disabledLink)}
        >
          <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
          {t("ui.table.previous")}
        </Link>
        <Link
          href={href(pathname, nextParams)}
          aria-disabled={!nextCursor || undefined}
          tabIndex={nextCursor ? undefined : -1}
          className={buttonClasses("secondary", "sm", nextCursor ? undefined : disabledLink)}
        >
          {t("ui.table.next")}
          <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
        </Link>
      </div>
    </nav>
  );
}

/** Offset pagination with totals (Kârmatik and Yanıt lists): "1–50 / 312". */
export function OffsetPagination({ offset, limit, total }: { offset: number; limit: number; total: number }) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const prev = new URLSearchParams(params.toString());
  const prevOffset = Math.max(0, offset - limit);
  if (prevOffset > 0) prev.set("offset", String(prevOffset));
  else prev.delete("offset");
  const next = new URLSearchParams(params.toString());
  next.set("offset", String(offset + limit));
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  return (
    <nav aria-label={t("ui.table.pagination")} className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
      <span className="text-sm text-fg-muted tabular">
        {t("ui.table.range", { from: formatNumber(from, locale), to: formatNumber(to, locale), total: formatNumber(total, locale) })}
      </span>
      <div className="flex items-center gap-2">
        <Link href={href(pathname, prev)} aria-disabled={!hasPrev || undefined} tabIndex={hasPrev ? undefined : -1} className={buttonClasses("secondary", "sm", hasPrev ? undefined : disabledLink)}>
          <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
          {t("ui.table.previous")}
        </Link>
        <Link href={href(pathname, next)} aria-disabled={!hasNext || undefined} tabIndex={hasNext ? undefined : -1} className={buttonClasses("secondary", "sm", hasNext ? undefined : disabledLink)}>
          {t("ui.table.next")}
          <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
        </Link>
      </div>
    </nav>
  );
}

/** "Load more" for time-before lists (assets, deliveries, discrepancies) that append pages. */
export function LoadMore({ onLoadMore, loading, hasMore }: { onLoadMore: () => void; loading: boolean; hasMore: boolean }) {
  const { t } = useI18n();
  if (!hasMore) return null;
  return (
    <div className="flex justify-center border-t border-border px-3 py-2">
      <Button size="sm" onClick={onLoadMore} loading={loading}>
        {t("ui.table.loadMore")}
      </Button>
    </div>
  );
}
