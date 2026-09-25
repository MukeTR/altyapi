"use client";

import { RadioGroup as RRadio, ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  options: readonly RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** Accessible name of the group (or pass aria-labelledby). */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  orientation?: "vertical" | "horizontal";
  className?: string;
  idPrefix?: string;
}

export function RadioGroup({ options, value, defaultValue, onValueChange, name, disabled, required, orientation = "vertical", className, idPrefix = "r", ...aria }: RadioGroupProps) {
  return (
    <RRadio.Root
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      {...(name ? { name } : {})}
      disabled={disabled ?? false}
      required={required ?? false}
      orientation={orientation}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      className={cn(orientation === "vertical" ? "flex flex-col gap-2.5" : "flex flex-wrap gap-4", className)}
    >
      {options.map((o) => {
        const id = `${idPrefix}-${name ?? "radio"}-${o.value}`;
        return (
          <div key={o.value} className="flex items-start gap-2.5">
            <RRadio.Item
              id={id}
              value={o.value}
              disabled={o.disabled ?? false}
              className={cn(
                "relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border-control bg-surface shadow-xs",
                "before:absolute before:-inset-1 before:content-[''] data-[state=checked]:border-accent disabled:cursor-not-allowed disabled:opacity-55",
              )}
            >
              <RRadio.Indicator className="block size-2 rounded-full bg-accent" />
            </RRadio.Item>
            <div className="flex flex-col gap-0.5">
              <label htmlFor={id} className="text-base text-fg">
                {o.label}
              </label>
              {o.description ? <p className="text-sm text-fg-muted">{o.description}</p> : null}
            </div>
          </div>
        );
      })}
    </RRadio.Root>
  );
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  /** Required when the label is only an icon. */
  "aria-label"?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: readonly SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  "aria-label": string;
  size?: "sm" | "md";
  className?: string;
}

/** Compact single choice (Test/Live mode, device preview). A value is always selected. */
export function SegmentedControl({ options, value, onValueChange, size = "md", className, ...aria }: SegmentedControlProps) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onValueChange(v);
      }}
      aria-label={aria["aria-label"]}
      className={cn("inline-flex w-fit self-start items-center gap-0.5 rounded-md border border-border-control bg-surface-muted p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled ?? false}
          aria-label={o["aria-label"]}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-sm px-2.5 font-medium text-fg-muted transition-colors [&_svg]:size-4",
            size === "sm" ? "h-6 text-sm" : "h-7 text-base",
            "hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-sm disabled:opacity-55",
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
