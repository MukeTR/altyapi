import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[720px] flex-col gap-6">
      <Skeleton className="h-6 w-48" />
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <Skeleton className="h-28 w-full" />
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}
