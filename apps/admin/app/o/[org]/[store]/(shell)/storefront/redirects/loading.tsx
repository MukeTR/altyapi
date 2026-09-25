import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function RedirectsLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <div className="px-4 py-3">
          <Skeleton className="h-8 w-72" />
        </div>
        <SkeletonTable rows={8} columns={5} />
      </div>
    </div>
  );
}
