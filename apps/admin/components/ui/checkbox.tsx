"use client";

import { Checkbox as RCheckbox } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./field";

export interface CheckboxProps {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  name?: string;
  value?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  /** Visible label; omit it only when aria-label is given (e.g. table row selection). */
  label?: ReactNode;
  description?: ReactNode;
  "aria-label"?: string;
  className?: string;
}

/** 16px box inside a 24px hit area; supports the indeterminate state for "select all". */
export function Checkbox({ checked, defaultChecked, onCheckedChange, name, value, disabled, required, id, label, description, className, ...aria }: CheckboxProps) {
  const field = useFieldControl(id);
  const autoId = useId();
  const boxId = field?.id ?? id ?? `c${autoId}`;
  const box = (
    <RCheckbox.Root
      id={boxId}
      {...(checked !== undefined ? { checked } : {})}
      {...(defaultChecked !== undefined ? { defaultChecked } : {})}
      onCheckedChange={(c) => onCheckedChange?.(c === true)}
      {...(name ? { name } : {})}
      {...(value ? { value } : {})}
      disabled={disabled ?? false}
      required={required ?? false}
      aria-label={aria["aria-label"]}
      aria-describedby={field?.["aria-describedby"]}
      className={cn(
        "peer relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-control bg-surface text-accent-fg shadow-xs",
        "before:absolute before:-inset-1 before:content-['']",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        "disabled:cursor-not-allowed disabled:opacity-55",
      )}
    >
      <RCheckbox.Indicator className="inline-flex">
        {checked === "indeterminate" ? <Minus aria-hidden="true" className="size-3" strokeWidth={3} /> : <Check aria-hidden="true" className="size-3" strokeWidth={3} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
  if (!label) return box;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <div className="flex h-5 items-center">{box}</div>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={boxId} className="text-base text-fg">
          {label}
        </label>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
    </div>
  );
}
