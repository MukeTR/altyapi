"use client";

import { Accordion as RAccordion, Collapsible as RCollapsible, ScrollArea as RScrollArea, VisuallyHidden as RVisuallyHidden } from "radix-ui";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Thin re-exports and styled wrappers of Radix primitives used across the admin. */

export const VisuallyHidden = RVisuallyHidden.Root;

export const Collapsible = RCollapsible.Root;
export const CollapsibleTrigger = RCollapsible.Trigger;
export const CollapsibleContent = RCollapsible.Content;

export function ScrollArea({ children, className, viewportClassName }: { children: ReactNode; className?: string; viewportClassName?: string }) {
  return (
    <RScrollArea.Root type="hover" className={cn("relative overflow-hidden", className)}>
      <RScrollArea.Viewport className={cn("size-full rounded-[inherit]", viewportClassName)}>{children}</RScrollArea.Viewport>
      <RScrollArea.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
        <RScrollArea.Thumb className="relative flex-1 rounded-full bg-border-control/50" />
      </RScrollArea.Scrollbar>
      <RScrollArea.Scrollbar orientation="horizontal" className="flex h-2 touch-none select-none flex-col p-0.5">
        <RScrollArea.Thumb className="relative flex-1 rounded-full bg-border-control/50" />
      </RScrollArea.Scrollbar>
    </RScrollArea.Root>
  );
}

export interface AccordionItem {
  value: string;
  title: ReactNode;
  content: ReactNode;
}

export function Accordion({ items, type = "multiple", defaultValue, className }: { items: readonly AccordionItem[]; type?: "single" | "multiple"; defaultValue?: string[]; className?: string }) {
  const body = items.map((item) => (
    <RAccordion.Item key={item.value} value={item.value} className="border-b border-border last:border-b-0">
      <RAccordion.Header className="flex">
        <RAccordion.Trigger className="group flex h-10 flex-1 items-center justify-between gap-2 px-1 text-start text-base font-medium text-fg hover:text-fg">
          {item.title}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle transition-transform group-data-[state=open]:rotate-180" />
        </RAccordion.Trigger>
      </RAccordion.Header>
      <RAccordion.Content className="px-1 pb-3 text-base text-fg-muted">{item.content}</RAccordion.Content>
    </RAccordion.Item>
  ));
  return type === "single" ? (
    <RAccordion.Root type="single" collapsible {...(defaultValue?.[0] ? { defaultValue: defaultValue[0] } : {})} className={className}>
      {body}
    </RAccordion.Root>
  ) : (
    <RAccordion.Root type="multiple" {...(defaultValue ? { defaultValue } : {})} className={className}>
      {body}
    </RAccordion.Root>
  );
}
