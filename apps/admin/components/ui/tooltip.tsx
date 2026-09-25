"use client";

import { Tooltip as RTooltip } from "radix-ui";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={300} skipDelayDuration={150}>
      {children}
    </RTooltip.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** The trigger; must be a focusable element that forwards refs (a <button> or <a>). */
  children: ReactNode;
}

/**
 * Supplementary text on hover and keyboard focus. Never the only way to reach essential
 * information (touch devices have no hover).
 */
export function Tooltip({ content, side = "top", children }: TooltipProps) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] max-w-xs rounded-md bg-fg px-2 py-1 text-xs text-surface shadow-md data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
