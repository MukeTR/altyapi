"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";

export interface BpsProps {
  /** Basis points (1234 = 12.34 %); null renders "—". */
  value: number | null | undefined;
  /** Delta display: sign and success/danger tone. */
  signed?: boolean;
  /** For deltas where lower is better. */
  invertTone?: boolean;
  className?: string;
}

export function Bps({ value, signed, invertTone, className }: BpsProps) {
  const { t, locale } = useI18n();
  if (value === null || value === undefined) {
    return (
      <span aria-label={t("ui.percent.unknown")} className={cn("text-fg-subtle", className)}>
        {t("common.none")}
      </span>
    );
  }
  const positive = invertTone ? value < 0 : value > 0;
  const negative = invertTone ? value > 0 : value < 0;
  return (
    <span className={cn("tabular whitespace-nowrap", signed && positive && "text-success", signed && negative && "text-danger", className)}>
      {formatBps(value, locale, { signed: signed ?? false })}
    </span>
  );
}
