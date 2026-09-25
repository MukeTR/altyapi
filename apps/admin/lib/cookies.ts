/** Cookie names shared by the proxy, server code and route handlers. */

/** The admin's own httpOnly session cookie; it holds the API session token, which is forwarded as a Bearer token. */
export const SESSION_COOKIE = "altyapi_admin_session";

export const PREFERENCE_COOKIES = {
  /** Interface language: tr | en. */
  locale: "admin_locale",
  /** Color theme: system | light | dark. */
  theme: "admin_theme",
  /** "1" when the sidebar is collapsed to the icon rail. */
  sidebar: "admin_sidebar",
  /** "<orgSlug>/<storeSlug>" of the store opened last. */
  lastStore: "admin_last_store",
} as const;

/** Preferences are kept for a year. */
export const PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;
