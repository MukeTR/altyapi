import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/** Loading state of record pages: header, a wide main column and a 320px aside. */
export function DetailPageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <Skeleton className="h-4 w-32" />
              <SkeletonText lines={4} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <Skeleton className="h-4 w-24" />
              <SkeletonText lines={3} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
