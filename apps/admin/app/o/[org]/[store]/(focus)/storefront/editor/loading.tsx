import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/** Editor-shaped skeleton: toolbar, section tree, preview canvas and properties panel. */
export default function EditorLoading() {
  return (
    <div role="status" aria-busy="true" className="flex h-dvh flex-col">
      <div className="flex h-12 items-center gap-3 border-b border-border bg-surface px-3">
        <Skeleton className="size-8" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="ms-auto h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[280px] flex-col gap-3 border-e border-border bg-surface p-3 lg:flex">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex flex-1 justify-center bg-surface-sunken p-4">
          <Skeleton className="h-full w-full max-w-[900px] rounded-md" />
        </div>
        <div className="hidden w-[340px] flex-col gap-4 border-s border-border bg-surface p-4 lg:flex">
          <Skeleton className="h-5 w-32" />
          <SkeletonText lines={6} />
        </div>
      </div>
    </div>
  );
}
