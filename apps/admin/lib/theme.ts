/** Theme preference handling shared by the root layout (server) and the user menu (client). */
export type ThemePreference = "system" | "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Inline <head> script that resolves a "system" preference before first paint, so dark-mode users
 * never see a light flash. Light and dark preferences are rendered on the server.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(d.dataset.themePref==="system"){d.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}}catch(e){}})();`;

/** Client only: applies a preference to <html> immediately (the cookie is saved separately). */
export function applyThemePreference(pref: ThemePreference): void {
  const root = document.documentElement;
  root.dataset.themePref = pref;
  root.dataset.theme = pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
}
