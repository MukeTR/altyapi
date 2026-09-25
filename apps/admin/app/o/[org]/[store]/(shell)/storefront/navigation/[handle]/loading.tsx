import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function MenuLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-48" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-border bg-surface p-5">
            <SkeletonText lines={2} />
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <SkeletonText lines={6} />
        </div>
      </div>
    </div>
  );
}
