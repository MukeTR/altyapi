"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { useOptionalStore } from "@/components/providers/store-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatRelative, timeZoneOffsetLabel, type DateStyle } from "@/lib/format";

export interface DateTimeProps {
  value: string | null | undefined;
  /** "relative" shows "12 dk önce" for the last 24 hours and falls back to date and time. */
  format?: DateStyle | "relative";
  /** Defaults to the store's time zone. */
  timeZone?: string;
  className?: string;
}

/**
 * A business timestamp in the store's time zone. The tooltip gives the full date with the zone
 * name and the UTC time.
 */
export function DateTime({ value, format = "datetime", timeZone, className }: DateTimeProps) {
  const { t, locale } = useI18n();
  const store = useOptionalStore();
  if (!value) return <span className={className}>{t("common.none")}</span>;
  const zone = timeZone ?? store?.store.timezone ?? "UTC";
  const text = format === "relative" ? (formatRelative(value, locale) ?? formatDateTime(value, locale, zone, "datetime")) : formatDateTime(value, locale, zone, format);
  const full = `${formatDateTime(value, locale, zone, "full")} (${zone}, ${timeZoneOffsetLabel(zone, new Date(value))})`;
  const utc = t("ui.datetime.utc", { value: formatDateTime(value, locale, "UTC", "datetime") });
  return (
    <Tooltip
      content={
        <span className="flex flex-col">
          <span>{full}</span>
          <span className="opacity-80">{utc}</span>
        </span>
      }
    >
      {/* Relative text depends on the current time, which differs between server and browser. */}
      <time dateTime={value} tabIndex={0} suppressHydrationWarning className={className}>
        {text}
      </time>
    </Tooltip>
  );
}
