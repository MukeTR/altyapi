import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-muted text-fg-muted border-border",
  accent: "bg-accent-subtle text-accent-subtle-fg border-transparent",
  success: "bg-success-bg text-success border-transparent",
  warning: "bg-warning-bg text-warning border-transparent",
  danger: "bg-danger-bg text-danger border-transparent",
  info: "bg-info-bg text-info border-transparent",
};

/** Counts, tags and short labels. Never the only carrier of meaning: always has text. */
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-xs font-medium", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}
