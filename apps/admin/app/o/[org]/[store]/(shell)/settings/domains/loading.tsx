import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function DomainsLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[960px] flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-5 w-64" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}
