import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CopyButton } from "./copy-button";

export interface CodeBlockProps {
  value: string;
  /** Accessible description of the value ("DNS kaydı", "Bildirim adresi"). */
  label: string;
  /** Visible caption above the value. */
  caption?: ReactNode;
  copyable?: boolean;
  multiline?: boolean;
  className?: string;
}

/** Monospace value with a copy button: DNS records, notification URLs, codes, support ids. */
export function CodeBlock({ value, label, caption, copyable = true, multiline, className }: CodeBlockProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {caption ? <span className="text-xs font-medium text-fg-muted">{caption}</span> : null}
      <div className="flex items-start gap-1 rounded-md border border-border bg-surface-muted py-1 ps-2.5 pe-1">
        <code className={cn("min-w-0 flex-1 py-0.5 font-mono text-sm text-fg", multiline ? "whitespace-pre-wrap break-all" : "truncate")} title={multiline ? undefined : value}>
          {value}
        </code>
        {copyable ? <CopyButton value={value} label={label} /> : null}
      </div>
    </div>
  );
}
