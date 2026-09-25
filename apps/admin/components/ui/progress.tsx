"use client";

import { Progress as RProgress } from "radix-ui";
import { cn } from "@/lib/cn";

export interface ProgressProps {
  /** null = indeterminate. */
  value: number | null;
  max?: number;
  /** Spoken value, e.g. "1.240 / 5.000 satır". */
  valueText?: string;
  "aria-label": string;
  className?: string;
}

export function Progress({ value, max = 100, valueText, className, ...aria }: ProgressProps) {
  const pct = value === null || max <= 0 ? null : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <RProgress.Root
      value={value}
      max={max}
      aria-label={aria["aria-label"]}
      {...(valueText ? { getValueLabel: () => valueText, "aria-valuetext": valueText } : {})}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      <RProgress.Indicator
        className={cn("h-full rounded-full bg-accent transition-[width] duration-300", pct === null && "w-1/3 animate-shimmer")}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </RProgress.Root>
  );
}
