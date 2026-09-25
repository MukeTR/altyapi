import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface StatProps {
  label: ReactNode;
  /** A real number from the API; never computed by summing a paged list. */
  value: ReactNode;
  delta?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

export function Stat({ label, value, delta, hint, className }: StatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-fg tabular">{value}</span>
        {delta ? <span className="text-sm">{delta}</span> : null}
      </span>
      {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
    </div>
  );
}
