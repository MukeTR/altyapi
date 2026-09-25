import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function MenusLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            <SkeletonText lines={3} />
          </div>
        ))}
      </div>
    </div>
  );
}
