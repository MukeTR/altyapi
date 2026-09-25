"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

export interface MoneyProps {
  /** Minor units as a string (API wire format); null renders "—" with an "Unknown" tooltip. */
  amount: string | null | undefined;
  currency: string;
  /** Compare-at amount, shown struck through after the amount. */
  compareAt?: string | null;
  className?: string;
}

export function Money({ amount, currency, compareAt, className }: MoneyProps) {
  const { t, locale } = useI18n();
  if (amount === null || amount === undefined) {
    return (
      <Tooltip content={t("ui.money.unknown")}>
        <span tabIndex={0} aria-label={t("ui.money.unknown")} className={cn("text-fg-subtle", className)}>
          {t("common.none")}
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={cn("tabular whitespace-nowrap", amount.startsWith("-") && "text-danger", className)}>
      {formatMoney(amount, currency, locale)}
      {compareAt ? <s className="ms-1.5 text-sm text-fg-subtle">{formatMoney(compareAt, currency, locale)}</s> : null}
    </span>
  );
}
