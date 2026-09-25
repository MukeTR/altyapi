"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";

export interface Step {
  id: string;
  label: ReactNode;
  description?: ReactNode;
}

export interface StepperProps {
  steps: readonly Step[];
  /** Index of the current step. */
  current: number;
  orientation?: "vertical" | "horizontal";
  "aria-label"?: string;
  className?: string;
}

/** Wizard progress (domain, import, ecosystem link, onboarding). */
export function Stepper({ steps, current, orientation = "horizontal", className, ...aria }: StepperProps) {
  const { t } = useI18n();
  return (
    <ol aria-label={aria["aria-label"] ?? t("ui.stepper.label")} className={cn(orientation === "vertical" ? "flex flex-col gap-4" : "flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.id} aria-current={active ? "step" : undefined} className="flex items-center gap-2.5">
            <span
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular",
                done ? "border-accent bg-accent text-accent-fg" : active ? "border-accent text-accent-subtle-fg" : "border-border-control text-fg-muted",
              )}
            >
              {done ? <Check aria-hidden="true" className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className="flex flex-col">
              <span className={cn("text-base", active ? "font-semibold text-fg" : "text-fg-muted")}>
                {step.label}
                {done ? <span className="sr-only"> ({t("ui.stepper.completed")})</span> : null}
              </span>
              {step.description && orientation === "vertical" ? <span className="text-sm text-fg-muted">{step.description}</span> : null}
            </span>
            {orientation === "horizontal" && i < steps.length - 1 ? <span aria-hidden="true" className="ms-1 hidden h-px w-8 bg-border sm:block" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
