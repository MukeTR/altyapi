"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { DayBucket } from "@/lib/commerce/overview-data";

const HEIGHT = 120;
const MAX_BAR = 16;

/** Noon of a store-local day, so formatting in the store zone never slips to a neighbour day. */
function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/**
 * Paid orders per day as a single-series column chart. Hover or arrow keys show a day's orders
 * and revenue; the same numbers are available as a table below the chart.
 */
export function DailyOrdersChart({ days, currency }: { days: DayBucket[]; currency: string }) {
  const { t, locale } = useI18n();
  const { store } = useStore();
  const tableId = useId();
  const [active, setActive] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...days.map((d) => d.paidOrders));
  const peak = days.reduce((best, d, i) => (d.paidOrders > (days[best]?.paidOrders ?? -1) ? i : best), 0);
  const label = (d: DayBucket) => formatDateTime(dayDate(d.date), locale, "UTC", "date");
  const ticks = useMemo(() => {
    const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
    return [0, Math.round(top / 2), top];
  }, [max]);
  const scaleTop = ticks[2] ?? max;

  const summary = t("dashboard.chart.summary", {
    total: formatNumber(days.reduce((s, d) => s + d.paidOrders, 0), locale),
    peak: formatNumber(days[peak]?.paidOrders ?? 0, locale),
    peakDay: days[peak] ? label(days[peak]) : "",
  });

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const i = Math.min(days.length - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * days.length)));
    setActive(i);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = (e.key === "ArrowRight") !== (document.dir === "rtl") ? 1 : -1;
      setActive((a) => Math.min(days.length - 1, Math.max(0, (a ?? days.length - 1) + dir)));
    } else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(days.length - 1);
    else if (e.key === "Escape") setActive(null);
  };

  const current = active !== null ? days[active] : undefined;

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div aria-hidden="true" className="flex w-6 flex-col justify-between pb-5 text-end text-xs text-fg-subtle tabular" style={{ height: HEIGHT + 20 }}>
          {[...ticks].reverse().map((v) => (
            <span key={v}>{formatNumber(v, locale)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={ref}
            role="img"
            tabIndex={0}
            aria-label={summary}
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="relative flex items-end rounded-sm border-b border-border outline-offset-4"
            style={{ height: HEIGHT }}
          >
            {/* Recessive gridlines at the tick values. */}
            {ticks.slice(1).map((v) => (
              <span key={v} aria-hidden="true" className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${(v / scaleTop) * 100}%` }} />
            ))}
            {days.map((d, i) => {
              const h = d.paidOrders === 0 ? 0 : Math.max(2, (d.paidOrders / scaleTop) * HEIGHT);
              return (
                <span key={d.date} aria-hidden="true" className="relative flex h-full flex-1 items-end justify-center">
                  <span
                    className={i === active ? "rounded-t bg-accent-hover" : "rounded-t bg-accent"}
                    style={{ height: h, width: `min(${MAX_BAR}px, calc(100% - 2px))` }}
                  />
                </span>
              );
            })}
          </div>
          {current ? (
            <div
              aria-live="polite"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm shadow-md"
              style={{ left: `${((active! + 0.5) / days.length) * 100}%` }}
            >
              <span className="block font-semibold text-fg tabular">{t("dashboard.chart.orders", { count: formatNumber(current.paidOrders, locale) })}</span>
              <span className="block text-fg-muted tabular">{formatMoney(current.revenue, currency, locale)}</span>
              <span className="block text-xs text-fg-subtle">{label(current)}</span>
            </div>
          ) : null}
          <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-fg-subtle">
            <span>{days[0] ? label(days[0]) : ""}</span>
            <span>{days.at(-1) ? label(days.at(-1)!) : ""}</span>
          </div>
        </div>
      </div>
      <figcaption className="text-xs text-fg-subtle">{t("dashboard.chart.caption", { timezone: store.timezone })}</figcaption>
      <details className="text-sm">
        <summary className="cursor-pointer text-link">{t("dashboard.chart.showTable")}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
          <table id={tableId} className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("dashboard.chart.tableCaption")}</caption>
            <thead className="sticky top-0 bg-surface-muted">
              <tr className="text-xs text-fg-muted">
                <th scope="col" className="px-2 py-1 text-start font-medium">
                  {t("dashboard.chart.day")}
                </th>
                <th scope="col" className="px-2 py-1 text-end font-medium">
                  {t("dashboard.chart.paidOrders")}
                </th>
                <th scope="col" className="px-2 py-1 text-end font-medium">
                  {t("dashboard.chart.revenue", { currency })}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <th scope="row" className="px-2 py-1 text-start font-normal">
                    {label(d)}
                  </th>
                  <td className="px-2 py-1 text-end tabular">{formatNumber(d.paidOrders, locale)}</td>
                  <td className="px-2 py-1 text-end tabular">{formatMoney(d.revenue, currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
