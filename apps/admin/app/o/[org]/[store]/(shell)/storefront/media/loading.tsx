import { Skeleton } from "@/components/ui/skeleton";

export default function MediaLoading() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex flex-col gap-3 px-4 pt-3">
          <Skeleton className="h-8 w-80 max-w-full" />
          <Skeleton className="h-8 w-72 max-w-full" />
        </div>
        <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="flex flex-col gap-1.5 rounded-lg border border-border p-1.5">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="h-4 w-3/4" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
