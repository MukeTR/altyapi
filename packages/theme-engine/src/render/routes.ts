import { listRouteTypes, matchContentRoute, servesIndexRoute, type ContentRouteMatch, type ContentRouteType } from "@altyapi/content";
import { and, eq, inArray, redirects, siteProfiles, withTenantTx, type Database } from "@altyapi/database";
import { contentModule, isReservedPathSegment, SITE_MODULES, type PageClass, type PageUrlStyle, type RegisteredRoute, type RouteCacheClass, type UntranslatedPolicy } from "@altyapi/site";

/**
 * The storefront route table (docs/platform/site-turleri-ve-cms.md §5, K9). Module manifests
 * own the fixed paths (/, /pages, /search, /products, /collections, /cart, /checkout) and the
 * content types their localized prefixes; nothing is hard-coded here. Resolution order:
 *
 *   1. language prefix (the store's non-default languages),
 *   2. module routes, longest path first; a route of a module that is off answers 404,
 *   3. content type prefixes, longest first (/{prefix}, /{prefix}/{slug}, taxonomy archives),
 *   4. root-level pages (page_url_style = root),
 *   5. redirects: exact rule, else the longest prefix rule; 410 for removed paths,
 *   6. not found.
 *
 * Each match carries the cache class and page class of the route that owns it.
 */

export interface RouteClass {
  cacheClass: RouteCacheClass;
  pageClass: PageClass;
}

export interface RouteTable {
  /** Active modules of the store (core included). */
  modules: readonly string[];
  /** Routable content types; empty while the content module is off. */
  contentTypes: readonly ContentRouteType[];
  pageUrlStyle: PageUrlStyle;
  untranslatedPolicy: UntranslatedPolicy;
}

export type RouteMatch =
  | ({ kind: "module"; route: RegisteredRoute; rest: string[] } & RouteClass)
  | ({ kind: "module_disabled"; route: RegisteredRoute } & RouteClass)
  | ({ kind: "content"; match: ContentRouteMatch } & RouteClass)
  /** A single segment that may be a page served at the root (root style) or a page's old root URL (prefixed style). */
  | ({ kind: "root_page"; handle: string } & RouteClass)
  | ({ kind: "none" } & RouteClass);

/** Page and cache class of paths no route owns (not-found and redirect answers). */
export const DEFAULT_ROUTE_CLASS: RouteClass = { cacheClass: "public", pageClass: "marketing" };

/**
 * Page class of a content type's routes: the content module's dynamic route class, refined for
 * built-in types whose pages are of a kind of their own (legal texts, service pages).
 */
export function contentPageClass(type: Pick<ContentRouteType, "builtinKey">): PageClass {
  if (type.builtinKey === "legal_document") return "legal";
  if (type.builtinKey === "service") return "service";
  return contentModule.dynamicRoutes?.[0]?.pageClass ?? "marketing";
}

const CONTENT_CACHE_CLASS: RouteCacheClass = contentModule.dynamicRoutes?.[0]?.cacheClass ?? "public";

/** Splits the language prefix off a path: "/en/blog/x" → en, "/blog/x". The default language has no prefix. */
export function splitLocale(path: string, supportedLocales: readonly string[], defaultLocale: string): { locale: string; path: string } {
  const seg = path.split("/")[1];
  if (seg && seg !== defaultLocale && supportedLocales.includes(seg)) return { locale: seg, path: path.slice(seg.length + 1) || "/" };
  return { locale: defaultLocale, path };
}

/** Module routes, longest path first, so /collections/x never matches a shorter route. */
const MODULE_ROUTES: readonly RegisteredRoute[] = [...SITE_MODULES.routes()].sort((a, b) => b.path.length - a.path.length);

function routePathIn(route: RegisteredRoute, locale: string): string {
  return (route.localizedPaths as Record<string, string | undefined> | undefined)?.[locale] ?? route.path;
}

/** The module route owning a path (language prefix removed), if any. */
export function moduleRouteOf(path: string, locale: string): RegisteredRoute | null {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return (
    MODULE_ROUTES.find((route) => {
      const own = routePathIn(route, locale);
      return clean === own || (route.match === "prefix" && own !== "/" && clean.startsWith(`${own}/`));
    }) ?? null
  );
}

/** Matches a path (language prefix removed) against the route table. */
export function matchRoute(table: RouteTable, locale: string, path: string): RouteMatch {
  const clean = path.split("?")[0]!.replace(/\/+$/, "") || "/";
  const route = moduleRouteOf(clean, locale);
  if (route) {
    const own = routePathIn(route, locale);
    const cls = { cacheClass: route.cacheClass, pageClass: route.pageClass };
    if (!table.modules.includes(route.module)) return { kind: "module_disabled", route, ...cls };
    const rest = clean === own ? [] : clean.slice(own.length + 1).split("/");
    return { kind: "module", route, rest, ...cls };
  }
  if (table.modules.includes("content") && table.contentTypes.length) {
    const match = matchContentRoute(table.contentTypes, locale, clean);
    // A type whose index route is off leaves /{prefix} to pages and redirects.
    if (match && !(match.kind === "index" && !servesIndexRoute(match.type))) {
      return { kind: "content", match, cacheClass: CONTENT_CACHE_CLASS, pageClass: contentPageClass(match.type) };
    }
  }
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 1 && !isReservedPathSegment(segments[0]!)) {
    return { kind: "root_page", handle: decodeURIComponent(segments[0]!), ...DEFAULT_ROUTE_CLASS };
  }
  return { kind: "none", ...DEFAULT_ROUTE_CLASS };
}

/** The route table of a store: its routable content types (when the content module is on) and page URL settings. */
export async function loadRouteTable(db: Database, ref: { organizationId: string; storeId: string }, modules: readonly string[]): Promise<RouteTable> {
  const [profile] = await withTenantTx(db, ref, (tx) =>
    tx.select({ pageUrlStyle: siteProfiles.pageUrlStyle, untranslatedPolicy: siteProfiles.untranslatedPolicy }).from(siteProfiles).where(eq(siteProfiles.storeId, ref.storeId)),
  );
  const contentTypes = modules.includes("content") ? await listRouteTypes(db, ref) : [];
  return {
    modules,
    contentTypes,
    pageUrlStyle: profile?.pageUrlStyle ?? "prefixed",
    untranslatedPolicy: profile?.untranslatedPolicy ?? "hide",
  };
}

/** Public path of a page: the home page at /, pages and landings under /pages/ or at the root. */
export function pagePath(type: string, handle: string, style: PageUrlStyle = "prefixed"): string | null {
  if (type === "home") return "/";
  if (type === "page" || type === "landing") return style === "root" ? `/${handle}` : `/pages/${handle}`;
  return null;
}

export interface RedirectHit {
  /** Target with the rest of the path carried over for prefix rules; null for 410 Gone. */
  toPath: string | null;
  statusCode: 301 | 302 | 410;
  source: string;
}

/** "/a/b/c" → ["/a/b/c", "/a/b", "/a"]: the path and every ancestor a prefix rule may start at. */
function pathAndAncestors(path: string): string[] {
  const out: string[] = [path];
  let p = path;
  while (p.lastIndexOf("/") > 0) {
    p = p.slice(0, p.lastIndexOf("/"));
    out.push(p);
  }
  return out;
}

/**
 * The redirect that applies to a full request path (language prefix included, as stored): a
 * rule starting at the path itself wins (exact or prefix), otherwise the longest prefix rule
 * starting at an ancestor, with the rest of the path appended to its target. One indexed
 * lookup (redirects_store_from_uq) for all candidates.
 */
export async function findRedirect(db: Database, ref: { organizationId: string; storeId: string }, path: string): Promise<RedirectHit | null> {
  const candidates = pathAndAncestors(path);
  const rows = await withTenantTx(db, ref, (tx) =>
    tx
      .select({ fromPath: redirects.fromPath, toPath: redirects.toPath, statusCode: redirects.statusCode, matchType: redirects.matchType, source: redirects.source })
      .from(redirects)
      .where(and(eq(redirects.storeId, ref.storeId), inArray(redirects.fromPath, candidates))),
  );
  const exact = rows.find((r) => r.fromPath === path);
  const rule = exact ?? rows.filter((r) => r.matchType === "prefix").sort((a, b) => b.fromPath.length - a.fromPath.length)[0];
  if (!rule) return null;
  const statusCode = rule.statusCode === 302 ? 302 : rule.statusCode === 410 ? 410 : 301;
  if (statusCode === 410 || !rule.toPath) return { toPath: null, statusCode: 410, source: rule.source };
  const rest = path.slice(rule.fromPath.length);
  // An absolute URL target keeps its own path; the rest is appended to paths only.
  const toPath = rest && rule.toPath.startsWith("/") ? `${rule.toPath.replace(/\/+$/, "")}${rest}` : rule.toPath;
  return { toPath, statusCode, source: rule.source };
}
