"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { Tooltip } from "./tooltip";

export interface CopyButtonProps {
  value: string;
  /** What is being copied, for the accessible name ("Copy {label}"). */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/** Copies to the clipboard and announces "Copied" politely. */
export function CopyButton({ value, label, size = "sm", className }: CopyButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const name = t("common.copyValue", { label });
  return (
    <>
      <Tooltip content={copied ? t("common.copied") : name}>
        <button
          type="button"
          onClick={copy}
          aria-label={name}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg",
            size === "sm" ? "size-7" : "size-8",
            className,
          )}
        >
          {copied ? <Check aria-hidden="true" className="size-4 text-success" /> : <Copy aria-hidden="true" className="size-4" />}
        </button>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {copied ? t("common.copied") : ""}
      </span>
    </>
  );
}
