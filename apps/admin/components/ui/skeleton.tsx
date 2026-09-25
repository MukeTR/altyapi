import { cn } from "@/lib/cn";

/** Loading placeholder. The pulse becomes a static tint under prefers-reduced-motion. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-shimmer rounded-md bg-surface-muted", className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Table-shaped skeleton: a header row plus `rows` 40px rows. */
export function SkeletonTable({ rows = 8, columns = 5, label }: { rows?: number; columns?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="w-full">
      <div className="flex h-9 items-center gap-4 border-b border-border bg-surface-muted px-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-10 items-center gap-4 border-b border-border px-3 last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3 flex-1", c === 0 && "max-w-40")} />
          ))}
        </div>
      ))}
    </div>
  );
}
