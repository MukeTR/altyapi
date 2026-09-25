"use client";

import { Toast as RToast } from "radix-ui";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { cn } from "@/lib/cn";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  /** Support code shown on error toasts. */
  correlationId?: string | null;
}

interface ToastEntry extends ToastInput {
  id: number;
  open: boolean;
}

interface ToastApi {
  toast: (input: ToastInput) => void;
  /** Error toast for a background or row action, with the localized API message and support code. */
  toastError: (error: ApiErrorInfo, title?: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const ICON_TONES = { success: "text-success", error: "text-danger", info: "text-info" } as const;

/**
 * Bottom-right toast region (F8 moves focus to it). Success and info toasts dismiss after 5 s;
 * error toasts stay until closed. Toasts never carry a form's only error message.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t, describeError } = useI18n();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-4), { ...input, id, open: true }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      toastError: (error, title) => {
        const d = describeError(error);
        toast({ tone: "error", title: title ?? d.message, ...(title ? { description: d.message } : {}), correlationId: d.correlationId });
      },
    }),
    [toast, describeError],
  );

  const close = (id: number) => {
    setToasts((list) => list.map((x) => (x.id === id ? { ...x, open: false } : x)));
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 200);
  };

  return (
    <ToastContext.Provider value={api}>
      <RToast.Provider swipeDirection="right" label={t("common.notifications")}>
        {children}
        {toasts.map((item) => {
          const tone = item.tone ?? "info";
          const Icon = ICONS[tone];
          return (
            <RToast.Root
              key={item.id}
              open={item.open}
              onOpenChange={(open) => {
                if (!open) close(item.id);
              }}
              duration={tone === "error" ? Number.POSITIVE_INFINITY : 5000}
              type={tone === "error" ? "foreground" : "background"}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 shadow-lg data-[state=open]:animate-toast-in data-[state=closed]:animate-fade-out data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]"
            >
              <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", ICON_TONES[tone])} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <RToast.Title className="text-base font-medium text-fg">{item.title}</RToast.Title>
                {item.description ? <RToast.Description className="text-sm text-fg-muted">{item.description}</RToast.Description> : null}
                {item.correlationId ? (
                  <p className="text-xs text-fg-subtle">
                    {t("common.supportCode")}: <code className="font-mono">{item.correlationId}</code>
                  </p>
                ) : null}
              </div>
              <RToast.Close aria-label={t("common.dismiss")} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg">
                <X aria-hidden="true" className="size-4" />
              </RToast.Close>
            </RToast.Root>
          );
        })}
        <RToast.Viewport
          hotkey={["F8"]}
          label={t("ui.toast.region")}
          className="fixed bottom-4 end-4 z-[70] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none"
        />
      </RToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside <ToastProvider>");
  return value;
}
