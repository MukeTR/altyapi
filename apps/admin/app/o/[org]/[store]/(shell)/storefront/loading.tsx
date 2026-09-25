import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

/** Pages list skeleton: header with actions, theme card and the table. */
export default function PagesLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex gap-3 px-4 py-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-24" />
          ))}
        </div>
        <SkeletonTable rows={8} columns={5} />
      </div>
    </div>
  );
}
