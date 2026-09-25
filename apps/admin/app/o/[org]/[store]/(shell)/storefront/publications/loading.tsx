import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function PublicationsLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <div className="px-4 py-4">
          <Skeleton className="h-4 w-56" />
        </div>
        <SkeletonTable rows={8} columns={5} />
      </div>
    </div>
  );
}
