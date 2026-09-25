import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

/** Loading state of list screens: header, optional tabs, toolbar and table rows. */
export function ListPageSkeleton({ tabs, rows = 8, columns = 6, actions = false }: { tabs?: boolean; rows?: number; columns?: number; actions?: boolean }) {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-40" />
        {actions ? <Skeleton className="h-8 w-32" /> : null}
      </div>
      <div className="rounded-lg border border-border bg-surface">
        {tabs ? (
          <div className="flex gap-4 border-b border-border px-4 py-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-4 w-20" />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 p-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-8 w-40" />
        </div>
        <SkeletonTable rows={rows} columns={columns} />
      </div>
    </div>
  );
}
