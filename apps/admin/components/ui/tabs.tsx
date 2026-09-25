"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs as RTabs } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const listClass = "flex items-center gap-1 overflow-x-auto border-b border-border";
const triggerClass =
  "relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 text-base font-medium text-fg-muted no-underline transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg aria-[current=page]:border-accent aria-[current=page]:text-fg";

export interface TabItem {
  value: string;
  label: ReactNode;
  content?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Keep the active tab in ?<param>= so the view can be linked and survives reloads. */
  searchParam?: string;
  "aria-label": string;
  className?: string;
}

/** In-page tabs (arrow keys move between tabs). With `searchParam` the selection is URL-synced. */
export function Tabs({ items, value, defaultValue, onValueChange, searchParam, className, ...aria }: TabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fromUrl = searchParam ? params.get(searchParam) : null;
  const current = value ?? (fromUrl && items.some((i) => i.value === fromUrl) ? fromUrl : undefined);

  const change = (next: string) => {
    onValueChange?.(next);
    if (searchParam) {
      const q = new URLSearchParams(params.toString());
      if (next === items[0]?.value) q.delete(searchParam);
      else q.set(searchParam, next);
      const s = q.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    }
  };

  return (
    <RTabs.Root
      {...(current !== undefined ? { value: current } : { defaultValue: defaultValue ?? items[0]?.value ?? "" })}
      onValueChange={change}
      className={cn("flex flex-col gap-4", className)}
    >
      <RTabs.List aria-label={aria["aria-label"]} className={listClass}>
        {items.map((i) => (
          <RTabs.Trigger key={i.value} value={i.value} className={triggerClass}>
            {i.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {items.map((i) =>
        i.content !== undefined ? (
          <RTabs.Content key={i.value} value={i.value} className="outline-none">
            {i.content}
          </RTabs.Content>
        ) : null,
      )}
    </RTabs.Root>
  );
}

export interface TabLinkItem {
  href: string;
  label: ReactNode;
  /** Match nested paths too (default: exact). */
  prefix?: boolean;
}

/** Tabs that are separate routes (path segments): rendered as a nav of links with aria-current. */
export function TabLinks({ items, "aria-label": label, className }: { items: readonly TabLinkItem[]; "aria-label": string; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={cn(listClass, className)}>
      {items.map((i) => {
        const active = i.prefix ? pathname === i.href || pathname.startsWith(`${i.href}/`) : pathname === i.href;
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={triggerClass}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
