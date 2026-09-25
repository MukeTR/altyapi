"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";

export interface Crumb {
  label: string;
  href?: string;
}

/** Trail above the page title; the current page itself is not repeated. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <nav aria-label={t("shell.breadcrumbs")}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
            {c.href ? (
              <Link href={c.href} className="text-fg-muted no-underline hover:text-fg hover:underline">
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
            {i < items.length - 1 ? <ChevronRight aria-hidden="true" className="size-3 text-fg-subtle rtl:rotate-180" /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
