"use client";

import { Select as RSelect } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./field";
import { controlClasses } from "./input-styles";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** Form field name: a hidden native select carries the value in form submissions. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  id?: string;
  /** Accessible name when the select is not inside a <Field>. */
  "aria-label"?: string;
  className?: string;
}

/** For short fixed lists (status filters, carriers, modes). Use Combobox for searchable lists. */
export function Select({ options, value, defaultValue, onValueChange, placeholder, name, required, disabled, size = "md", id, className, ...aria }: SelectProps) {
  const field = useFieldControl(id);
  const { t } = useI18n();
  return (
    <RSelect.Root
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      {...(name ? { name } : {})}
      {...(required ? { required } : {})}
      {...(disabled ? { disabled } : {})}
    >
      <RSelect.Trigger
        id={field?.id ?? id}
        aria-label={aria["aria-label"]}
        aria-describedby={field?.["aria-describedby"]}
        aria-invalid={field?.["aria-invalid"]}
        className={cn(
          controlClasses({ size, invalid: field?.["aria-invalid"] === true }),
          "inline-flex items-center justify-between gap-2 text-start data-[placeholder]:text-fg-subtle",
          className,
        )}
      >
        <span className="truncate">
          <RSelect.Value placeholder={placeholder ?? t("common.select")} />
        </span>
        <RSelect.Icon>
          <ChevronDown aria-hidden="true" className="size-4 text-fg-subtle" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-md data-[state=open]:animate-pop-in"
        >
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                {...(o.disabled ? { disabled: true } : {})}
                className="relative flex h-8 cursor-default select-none items-center rounded-md ps-7 pe-2 text-base text-fg outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted"
              >
                <RSelect.ItemIndicator className="absolute start-2 inline-flex">
                  <Check aria-hidden="true" className="size-4 text-accent" />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
