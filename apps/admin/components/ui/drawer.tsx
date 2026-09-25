"use client";

import { Dialog as RDialog } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export interface DrawerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Opening edge; "start" is used for the mobile navigation. */
  side?: "start" | "end";
  width?: 280 | 480 | 640;
  footer?: ReactNode;
  /** Hide the visible header (the title stays available to assistive technology). */
  hideHeader?: boolean;
  children?: ReactNode;
}

/** Side sheet: full height, focus trapped, sticky footer actions. */
export function Drawer({ open, onOpenChange, trigger, title, description, side = "end", width = 480, footer, hideHeader, children }: DrawerProps) {
  const { t } = useI18n();
  return (
    <RDialog.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger ? <RDialog.Trigger asChild>{trigger}</RDialog.Trigger> : null}
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RDialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col border-border bg-surface shadow-lg outline-none",
            side === "start" ? "start-0 border-e data-[state=open]:animate-sheet-in-left" : "end-0 border-s data-[state=open]:animate-sheet-in-right",
            width === 280 ? "max-w-[280px]" : width === 640 ? "max-w-[640px]" : "max-w-[480px]",
          )}
        >
          <div className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", hideHeader && "sr-only")}>
            <div className="flex flex-col gap-1">
              <RDialog.Title className="text-md font-semibold text-fg">{title}</RDialog.Title>
              {description ? <RDialog.Description className="text-base text-fg-muted">{description}</RDialog.Description> : null}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.close")}>
                <X aria-hidden="true" />
              </Button>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
