"use client";

import { useCallback, useEffect, useRef, useState, type Ref, type TextareaHTMLAttributes } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with the content up to this many rows (default 12). */
  maxRows?: number;
  showCount?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, id, rows = 3, maxRows = 12, showCount, maxLength, onChange, ref, ...rest }: TextareaProps) {
  const field = useFieldControl(id);
  const { t } = useI18n();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [length, setLength] = useState(() => String(rest.value ?? rest.defaultValue ?? "").length);
  const count = rest.value !== undefined ? String(rest.value).length : length;
  const invalid = field?.["aria-invalid"] === true;

  const resize = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, lineHeight * maxRows + 14)}px`;
  }, [maxRows]);

  useEffect(resize, [resize, rest.value]);

  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        id={field?.id ?? id}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => {
          setLength(e.target.value.length);
          resize();
          onChange?.(e);
        }}
        {...(field ? { "aria-describedby": field["aria-describedby"], "aria-invalid": field["aria-invalid"], "aria-required": field["aria-required"] } : {})}
        {...rest}
        className={cn(
          "w-full min-w-0 resize-none rounded-md border bg-surface px-2.5 py-1.5 text-base text-fg shadow-xs",
          "placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:bg-surface-muted",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
          invalid ? "border-danger" : "border-border-control",
          className,
        )}
      />
      {showCount && maxLength ? (
        <p className={cn("text-end text-xs tabular", count > maxLength * 0.9 ? "text-warning" : "text-fg-subtle")}>
          <span aria-hidden="true">
            {count}/{maxLength}
          </span>
          <span className="sr-only" aria-live="polite">
            {count >= maxLength * 0.9 ? t("ui.field.characterLimitNear", { remaining: maxLength - count }) : ""}
          </span>
        </p>
      ) : null}
    </div>
  );
}
