"use client";

import { AlertDialog as RAlert, Dialog as RDialog } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { Button } from "./button";

const WIDTHS = { sm: "max-w-[400px]", md: "max-w-[560px]", lg: "max-w-[720px]" } as const;

const overlayClass = "fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out";
const panelClass =
  "fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-xl border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out";

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (rendered with asChild). */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof WIDTHS;
  /** Sticky footer (actions). */
  footer?: ReactNode;
  children?: ReactNode;
  /** Keep the dialog open on outside click (forms with unsaved input). */
  modalLock?: boolean;
}

/** Modal for forms. Focus is trapped and returns to the trigger on close; Esc closes it. */
export function Dialog({ open, onOpenChange, trigger, title, description, size = "md", footer, children, modalLock }: DialogProps) {
  const { t } = useI18n();
  return (
    <RDialog.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger ? <RDialog.Trigger asChild>{trigger}</RDialog.Trigger> : null}
      <RDialog.Portal>
        <RDialog.Overlay className={overlayClass} />
        <RDialog.Content
          className={cn(panelClass, WIDTHS[size])}
          {...(modalLock ? { onInteractOutside: (e: Event) => e.preventDefault() } : {})}
          onKeyDown={(e) => {
            // ⌘Enter / Ctrl+Enter submits the dialog's form from any field.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              const form = e.currentTarget.querySelector("form");
              if (form) {
                e.preventDefault();
                form.requestSubmit();
              }
            }
          }}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="flex flex-col gap-1">
              <RDialog.Title className="text-md font-semibold text-fg">{title}</RDialog.Title>
              {description ? <RDialog.Description className="text-base text-fg-muted">{description}</RDialog.Description> : null}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} className="-me-1.5 -mt-1">
                <X aria-hidden="true" />
              </Button>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const DialogClose = RDialog.Close;

export interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  /** Plain-language consequence of the action. */
  description: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  onConfirm: () => void;
  /** Keeps the dialog open with a spinner while the action runs. */
  pending?: boolean;
  tone?: "danger" | "primary";
  /** Extra content (typed confirmation, switches, inline error). */
  children?: ReactNode;
  confirmDisabled?: boolean;
}

/** Confirmation for destructive or irreversible actions; initial focus is on Cancel. */
export function AlertDialog({ open, onOpenChange, trigger, title, description, confirmLabel, cancelLabel, onConfirm, pending, tone = "danger", children, confirmDisabled }: AlertDialogProps) {
  const { t } = useI18n();
  return (
    <RAlert.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger ? <RAlert.Trigger asChild>{trigger}</RAlert.Trigger> : null}
      <RAlert.Portal>
        <RAlert.Overlay className={overlayClass} />
        <RAlert.Content className={cn(panelClass, WIDTHS.sm)}>
          <div className="flex flex-col gap-2 px-5 pt-5">
            <RAlert.Title className="text-md font-semibold text-fg">{title}</RAlert.Title>
            <RAlert.Description className="text-base text-fg-muted">{description}</RAlert.Description>
          </div>
          {children ? <div className="px-5 pt-3">{children}</div> : null}
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4">
            <RAlert.Cancel asChild>
              <Button disabled={pending}>{cancelLabel ?? t("common.cancel")}</Button>
            </RAlert.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              loading={pending ?? false}
              disabled={confirmDisabled ?? false}
              onClick={(e) => {
                // The dialog stays open until the caller closes it, so errors can be shown inside.
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </RAlert.Content>
      </RAlert.Portal>
    </RAlert.Root>
  );
}
