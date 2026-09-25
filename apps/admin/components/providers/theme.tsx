"use client";

import { useEffect } from "react";
import { applyThemePreference } from "@/lib/theme";

/** Keeps a "system" preference in sync when the operating system switches between light and dark. */
export function ThemeSync() {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (document.documentElement.dataset.themePref === "system") applyThemePreference("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return null;
}
