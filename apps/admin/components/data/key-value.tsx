import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/cn";

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Adds a copy button for this raw value. */
  copy?: { value: string; label: string };
  mono?: boolean;
}

/** Two-column description list (label 160px, muted). */
export function KeyValue({ items, className }: { items: readonly KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[160px_minmax(0,1fr)]", className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-sm text-fg-muted sm:pt-0.5">{item.label}</dt>
          <dd className={cn("-mt-2 flex min-w-0 items-center gap-1 text-base text-fg sm:mt-0", item.mono && "font-mono text-sm")}>
            <span className="min-w-0 break-words">{item.value}</span>
            {item.copy ? <CopyButton value={item.copy.value} label={item.copy.label} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
