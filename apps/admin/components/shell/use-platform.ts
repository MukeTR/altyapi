"use client";

import { useEffect, useState } from "react";

/** True on Apple platforms (after mount; the server renders the non-Mac variant). */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);
  return isMac;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
  }
  return false;
}

/** A modal (dialog, drawer, palette) is open: global shortcuts other than ⌘K stay quiet. */
export function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}
