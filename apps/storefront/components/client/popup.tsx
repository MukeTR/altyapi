"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { track } from "@/lib/client/track";

type Trigger =
  | { type: "page_load"; delaySeconds: number }
  | { type: "exit_intent" }
  | { type: "scroll"; percent: number }
  | { type: "timer"; seconds: number };

type Frequency = { type: "once" | "session" | "every_n_days" | "always"; days: number };

function seenRecently(key: string, f: Frequency): boolean {
  try {
    if (f.type === "always") return false;
    if (f.type === "session") return sessionStorage.getItem(key) === "1";
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    if (f.type === "once") return true;
    return Date.now() - Number(raw) < f.days * 86_400_000;
  } catch {
    return false;
  }
}

function markSeen(key: string, f: Frequency) {
  try {
    if (f.type === "session") sessionStorage.setItem(key, "1");
    else if (f.type !== "always") localStorage.setItem(key, String(Date.now()));
  } catch {
    // storage unavailable
  }
}

/** Marketing popup with trigger and frequency rules; focus is trapped while open. */
export function Popup({
  id,
  trigger,
  frequency,
  placement,
  couponCode,
  campaignId,
  labels,
  children,
}: {
  id: string;
  trigger: Trigger;
  frequency: Frequency;
  placement: "modal" | "slide-in" | "bar";
  couponCode: string | null;
  campaignId: string | null;
  labels: { close: string; copy: string; copied: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const key = `sf_popup_${id}`;

  useEffect(() => {
    if (seenRecently(key, frequency)) return;
    const show = () => {
      setOpen(true);
      markSeen(key, frequency);
      track("popup_viewed", { popupId: id, campaignId });
    };
    if (trigger.type === "page_load" || trigger.type === "timer") {
      const t = setTimeout(show, (trigger.type === "timer" ? trigger.seconds : trigger.delaySeconds) * 1000);
      return () => clearTimeout(t);
    }
    if (trigger.type === "scroll") {
      const onScroll = () => {
        const pct = ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100;
        if (pct >= trigger.percent) {
          show();
          window.removeEventListener("scroll", onScroll);
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) {
        show();
        document.removeEventListener("mouseout", onLeave);
      }
    };
    document.addEventListener("mouseout", onLeave);
    return () => document.removeEventListener("mouseout", onLeave);
  }, [key, frequency, trigger, id, campaignId]);

  useEffect(() => {
    if (!open || placement !== "modal") return;
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button, a, input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement]);

  function close() {
    setOpen(false);
    track("popup_closed", { popupId: id, campaignId });
  }

  if (!open) return null;
  const panel =
    placement === "bar"
      ? "fixed inset-x-0 bottom-0 z-50 p-4 shadow-lg"
      : placement === "slide-in"
        ? "fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-theme p-6 shadow-xl"
        : "relative w-[min(32rem,calc(100vw-2rem))] rounded-theme p-6 shadow-xl";
  const content = (
    <div ref={dialog} data-scheme="default" className={panel} role="dialog" aria-modal={placement === "modal"} aria-labelledby={`${key}-title`}>
      <button type="button" aria-label={labels.close} onClick={close} className="absolute right-3 top-2 text-xl">
        ×
      </button>
      <div
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a")) track("popup_clicked", { popupId: id, campaignId });
        }}
      >
        {children}
      </div>
      {couponCode && (
        <button
          type="button"
          className="btn btn-outline mt-4 w-full font-mono"
          onClick={async () => {
            await navigator.clipboard.writeText(couponCode).catch(() => undefined);
            setCopied(true);
            track("coupon_copied", { popupId: id, couponCode, campaignId });
          }}
        >
          {couponCode} · {copied ? labels.copied : labels.copy}
        </button>
      )}
    </div>
  );
  return placement === "modal" ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && close()}>
      {content}
    </div>
  ) : (
    content
  );
}
