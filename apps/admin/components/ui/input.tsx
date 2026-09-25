"use client";

import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./field";
import { controlClasses } from "./input-styles";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  size?: "sm" | "md" | "lg";
  /** Text or icon shown inside the control before the value (e.g. "https://"). */
  prefix?: ReactNode;
  /** Text or icon shown after the value (e.g. a currency code or "%"). */
  suffix?: ReactNode;
  /** Shows a character counter when maxLength is set. */
  showCount?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = "md", prefix, suffix, showCount, className, id, maxLength, onChange, ref, ...rest }: InputProps) {
  const field = useFieldControl(id);
  const { t } = useI18n();
  const [length, setLength] = useState(() => String(rest.value ?? rest.defaultValue ?? "").length);
  const count = rest.value !== undefined ? String(rest.value).length : length;
  const invalid = field?.["aria-invalid"] === true || rest["aria-invalid"] === true || rest["aria-invalid"] === "true";
  const input = (
    <input
      ref={ref}
      id={field?.id ?? id}
      maxLength={maxLength}
      onChange={(e) => {
        setLength(e.target.value.length);
        onChange?.(e);
      }}
      {...(field ? { "aria-describedby": field["aria-describedby"], "aria-invalid": field["aria-invalid"], "aria-required": field["aria-required"] } : {})}
      {...rest}
      className={
        prefix || suffix
          ? "h-full min-w-0 flex-1 bg-transparent px-0 text-inherit outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
          : controlClasses({ size, invalid, className })
      }
    />
  );
  const counter =
    showCount && maxLength ? (
      <p className={cn("text-end text-xs tabular", count > maxLength * 0.9 ? "text-warning" : "text-fg-subtle")}>
        <span aria-hidden="true">
          {count}/{maxLength}
        </span>
        <span className="sr-only" aria-live="polite">
          {count >= maxLength * 0.9 ? t("ui.field.characterLimitNear", { remaining: maxLength - count }) : ""}
        </span>
      </p>
    ) : null;

  if (!prefix && !suffix) {
    return counter ? (
      <div className="flex flex-col gap-1">
        {input}
        {counter}
      </div>
    ) : (
      input
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          controlClasses({ size, invalid, className }),
          "flex items-center gap-2 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
          rest.disabled && "cursor-not-allowed bg-surface-muted text-fg-muted",
        )}
      >
        {prefix ? <span className="shrink-0 text-fg-subtle [&_svg]:size-4">{prefix}</span> : null}
        {input}
        {suffix ? <span className="shrink-0 text-fg-subtle [&_svg]:size-4">{suffix}</span> : null}
      </div>
      {counter}
    </div>
  );
}
