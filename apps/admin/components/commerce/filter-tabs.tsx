"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useUrlFilters } from "./use-url-filters";

export interface FilterTab {
  /** Value of the query parameter; null is the "all" tab. */
  value: string | null;
  label: ReactNode;
}

/** Status tabs of a list page, kept in one query parameter (links, so they work without JS). */
export function FilterTabs({ param, tabs, "aria-label": label, className }: { param: string; tabs: readonly FilterTab[]; "aria-label": string; className?: string }) {
  const { params, hrefWith } = useUrlFilters();
  const current = params.get(param);
  return (
    <nav aria-label={label} className={cn("flex items-center gap-1 overflow-x-auto border-b border-border px-2", className)}>
      {tabs.map((tab) => {
        const active = (tab.value ?? null) === (current || null);
        return (
          <Link
            key={tab.value ?? "all"}
            href={hrefWith({ [param]: tab.value })}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-2.5 text-base font-medium no-underline transition-colors",
              active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
