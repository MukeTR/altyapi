import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/** Loading state of settings screens: header and FormSection rows (title left, card right). */
export function SettingsPageSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-[960px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <SkeletonText lines={2} />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Loading state of card-based settings screens (payments, team). */
export function CardsPageSkeleton({ cards = 2, width = "960px" }: { cards?: number; width?: "960px" | "1200px" | "1440px" }) {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex flex-col gap-6" style={{ maxWidth: width }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-5 w-56" />
          <SkeletonText lines={3} />
        </div>
      ))}
    </div>
  );
}
