import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  /** One sentence. */
  description?: ReactNode;
  /** Primary action (and optionally a secondary one). */
  actions?: ReactNode;
  /** Render the title as a heading of this level (when the empty state is the page's main content). */
  headingLevel?: 1 | 2 | 3;
  className?: string;
}

/** First-use and filtered-empty states, shown inside the card that would hold the data. */
export function EmptyState({ icon: Icon, title, description, actions, headingLevel, className }: EmptyStateProps) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : "p";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {Icon ? (
        <span className="mb-1 inline-flex size-10 items-center justify-center rounded-full bg-surface-muted text-fg-muted">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      ) : null}
      <Title className="text-md font-semibold text-fg">{title}</Title>
      {description ? <p className="max-w-md text-base text-fg-muted">{description}</p> : null}
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
