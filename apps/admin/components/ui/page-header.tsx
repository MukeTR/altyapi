import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";

export interface PageHeaderProps {
  title: ReactNode;
  breadcrumbs?: readonly Crumb[];
  /** Status pills next to the title. */
  status?: ReactNode;
  /** Secondary line under the title (e.g. created date). */
  meta?: ReactNode;
  /** At most one primary button, then secondary buttons, then an overflow menu. */
  actions?: ReactNode;
  /** Tabs directly under the header. */
  tabs?: ReactNode;
  className?: string;
}

/** Page title block. The single <h1> of every screen lives here. */
export function PageHeader({ title, breadcrumbs, status, meta, actions, tabs, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-fg">{title}</h1>
            {status}
          </div>
          {meta ? <div className="text-sm text-fg-muted">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs}
    </header>
  );
}
