"use client";

import { DropdownMenu as RMenu } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const contentClass = "z-50 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-md outline-none data-[state=open]:animate-pop-in";
const itemClass =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-base text-fg outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted";

export const DropdownMenu = RMenu.Root;
export const DropdownMenuTrigger = RMenu.Trigger;
export const DropdownMenuGroup = RMenu.Group;
export const DropdownMenuSub = RMenu.Sub;
export const DropdownMenuRadioGroup = RMenu.RadioGroup;

export function DropdownMenuContent({ children, align = "end", className, ...rest }: { children: ReactNode; align?: "start" | "center" | "end"; className?: string; "aria-label"?: string }) {
  return (
    <RMenu.Portal>
      <RMenu.Content align={align} sideOffset={4} collisionPadding={8} className={cn(contentClass, className)} {...rest}>
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  tone,
  className,
}: {
  children: ReactNode;
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  tone?: "danger";
  className?: string;
}) {
  return (
    <RMenu.Item
      {...(onSelect ? { onSelect } : {})}
      disabled={disabled ?? false}
      className={cn(itemClass, tone === "danger" && "text-danger [&_svg]:text-danger", className)}
    >
      {children}
    </RMenu.Item>
  );
}

/** Menu item that navigates; renders a real <a> so it can be opened in a new tab. */
export function DropdownMenuLinkItem({ children, className, ...rest }: { children: ReactNode; href: string; target?: string; rel?: string; className?: string }) {
  return (
    <RMenu.Item asChild className={cn(itemClass, "no-underline", className)}>
      <a {...rest}>{children}</a>
    </RMenu.Item>
  );
}

export function DropdownMenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RMenu.RadioItem value={value} className={cn(itemClass, "ps-7")}>
      <RMenu.ItemIndicator className="absolute start-2 inline-flex">
        <Check aria-hidden="true" className="!text-accent" />
      </RMenu.ItemIndicator>
      {children}
    </RMenu.RadioItem>
  );
}

export function DropdownMenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <RMenu.Label className={cn("px-2 pb-1 pt-1.5 text-xs font-medium text-fg-subtle", className)}>{children}</RMenu.Label>;
}

export function DropdownMenuSeparator() {
  return <RMenu.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export function DropdownMenuSubTrigger({ children }: { children: ReactNode }) {
  return (
    <RMenu.SubTrigger className={cn(itemClass, "data-[state=open]:bg-surface-muted")}>
      {children}
      <ChevronRight aria-hidden="true" className="ms-auto rtl:rotate-180" />
    </RMenu.SubTrigger>
  );
}

export function DropdownMenuSubContent({ children }: { children: ReactNode }) {
  return (
    <RMenu.Portal>
      <RMenu.SubContent sideOffset={4} collisionPadding={8} className={contentClass}>
        {children}
      </RMenu.SubContent>
    </RMenu.Portal>
  );
}
