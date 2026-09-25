"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { VisibleNavItem } from "@/lib/nav";
import { isEditableTarget, modalOpen } from "./use-platform";

export interface GlobalShortcutHandlers {
  togglePalette: () => void;
  openPalette: () => void;
  openShortcuts: () => void;
}

/**
 * ⌘K / Ctrl+K toggles the command palette everywhere (also inside fields). "/" opens it and
 * "?" opens the shortcut list; "g" followed by a nav item's key navigates. Those never fire
 * while typing in a field or while a modal is open.
 */
export function useGlobalShortcuts(nav: readonly VisibleNavItem[], handlers: GlobalShortcutHandlers) {
  const router = useRouter();
  const pendingG = useRef<number | null>(null);
  const latest = useRef({ nav, handlers });
  latest.current = { nav, handlers };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { nav: items, handlers: h } = latest.current;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        h.togglePalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isEditableTarget(e.target) || modalOpen()) return;

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = items.find((i) => i.goKey === e.key.toLowerCase());
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        h.openPalette();
      } else if (e.key === "?") {
        e.preventDefault();
        h.openShortcuts();
      } else if (e.key === "g") {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 1000);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (pendingG.current !== null) window.clearTimeout(pendingG.current);
    };
  }, [router]);
}
