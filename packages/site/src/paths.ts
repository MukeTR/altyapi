import { isLocaleCode } from "@altyapi/commerce-core";
import { SITE_MODULES } from "./modules/index";

/**
 * First path segments the platform serves outside the module route table: the checkout and
 * account apps, APIs, framework assets, crawler and feed files, media and preview endpoints.
 */
export const PLATFORM_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "checkout",
  "account",
  "api",
  "_next",
  "__edge",
  "__not_found__",
  "robots.txt",
  "sitemap.xml",
  "sitemaps",
  "llms.txt",
  "feeds",
  "feed",
  "rss",
  "cdn",
  "cdn-cgi",
  "assets",
  "media",
  "static",
  "admin",
  "preview",
  "favicon.ico",
]);

/** First segments of every module route (whether or not the module is on for a store: it may be turned on later). */
const MODULE_ROUTE_SEGMENTS: ReadonlySet<string> = new Set(
  SITE_MODULES.routes().flatMap((r) => [r.path, ...Object.values(r.localizedPaths ?? {})].map((p) => (p ?? "").split("/")[1] ?? "").filter(Boolean)),
);

/**
 * True when a first path segment (without the language prefix) can never be merchant
 * content: a module route, a platform path or a language code (/en/… is the English site).
 * Content type prefixes and root-level page handles must avoid it.
 */
export function isReservedPathSegment(segment: string): boolean {
  const s = segment.toLowerCase();
  return MODULE_ROUTE_SEGMENTS.has(s) || PLATFORM_PATH_SEGMENTS.has(s) || isLocaleCode(s);
}

/**
 * True when a content type answers /{prefix} itself: a singleton (its entry), or a collection
 * whose index route is on (indexMode auto, the default). With indexMode page or none the path
 * is left to pages and redirects; taxonomies have no routes.
 */
export function servesIndexRoute(type: { kind: string; settings: { indexMode?: string | undefined } }): boolean {
  return type.kind === "singleton" || (type.kind === "collection" && (type.settings.indexMode ?? "auto") === "auto");
}
