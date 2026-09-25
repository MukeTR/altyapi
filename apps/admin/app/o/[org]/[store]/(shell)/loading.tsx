import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/** Default skeleton for store screens: page header and two cards. Screens add their own loading.tsx. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-4 w-40" />
            <SkeletonText lines={4} />
          </div>
        ))}
      </div>
    </div>
  );
}
