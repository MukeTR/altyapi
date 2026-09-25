"use client";

import { Popover as RPopover } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  /** Accessible name of the popover content (e.g. "Filters"). */
  "aria-label"?: string;
}

/** Non-modal floating panel (filters, preview link, color picker). */
export function Popover({ trigger, children, open, onOpenChange, align = "start", side = "bottom", className, ...aria }: PopoverProps) {
  return (
    <RPopover.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          aria-label={aria["aria-label"]}
          className={cn("z-50 w-72 rounded-lg border border-border bg-surface p-3 shadow-md outline-none data-[state=open]:animate-pop-in", className)}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export const PopoverClose = RPopover.Close;
