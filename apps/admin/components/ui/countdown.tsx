"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";

export interface CountdownProps {
  /** ISO timestamp when the code or link expires. */
  expiresAt: string;
  onExpire?: () => void;
  className?: string;
}

function remainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
}

/**
 * mm:ss until expiry (ecosystem codes, pending links). Screen readers are told only at one
 * minute left and at expiry, not every second.
 */
export function Countdown({ expiresAt, onExpire, className }: CountdownProps) {
  const { t } = useI18n();
  const [left, setLeft] = useState(() => remainingSeconds(expiresAt));

  useEffect(() => {
    setLeft(remainingSeconds(expiresAt));
    const timer = setInterval(() => {
      const next = remainingSeconds(expiresAt);
      setLeft(next);
      if (next === 0) {
        clearInterval(timer);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const announcement = left === 0 ? t("ui.countdown.expired") : left <= 60 ? t("ui.countdown.oneMinute") : "";
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm tabular", left === 0 ? "text-danger" : left <= 60 ? "text-warning" : "text-fg-muted", className)}>
      <span aria-label={t("ui.countdown.remaining", { time: `${mm}:${ss}` })}>
        {mm}:{ss}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
}
