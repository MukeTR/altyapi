"use client";

import { Switch as RSwitch } from "radix-ui";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  name?: string;
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
  /** Hide the label visually (still announced). */
  hideLabel?: boolean;
  id?: string;
  className?: string;
}

/**
 * Immediate-effect toggles only where an optimistic change is safe; otherwise put the switch in
 * a form with a Save button.
 */
export function Switch({ checked, defaultChecked, onCheckedChange, name, disabled, label, description, hideLabel, id, className }: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? `s${autoId}`;
  const descriptionId = description ? `${switchId}-description` : undefined;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className={cn("flex flex-col gap-0.5", hideLabel && "sr-only")}>
        <label htmlFor={switchId} className="text-base font-medium text-fg">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-sm text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      <RSwitch.Root
        id={switchId}
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange ? { onCheckedChange } : {})}
        {...(name ? { name } : {})}
        disabled={disabled ?? false}
        aria-describedby={descriptionId}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-control bg-surface-muted transition-colors",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-55",
        )}
      >
        <RSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-fg-muted shadow-sm transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-white rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-[18px]" />
      </RSwitch.Root>
    </div>
  );
}
