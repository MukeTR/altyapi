import { isLocaleCode } from "@altyapi/commerce-core/locales";
import type { ModuleRouteDef, RouteCacheClass } from "./manifest";
import { SITE_MODULE_MANIFESTS } from "./modules/manifests";

/**
 * Cache class of a storefront request path, decided from the module manifests alone (plan
 * §5, K9). The layers in front of the renderer (the storefront proxy, which sets the shared
 * cache headers the edge router honors) must decide before a route is resolved and without a
 * database, so this reads only what the manifests declare:
 *
 *   - a module route (fixed path, or its localized path in any language) has its own class:
 *     cart and checkout are private, product and collection pages public;
 *   - content type routes are the content module's dynamic routes (public), and pages, root
 *     pages and not-found answers are public too;
 *   - the storefront's own endpoints and per-visitor apps (/api, /account, preview) are private.
 *
 * The language prefix is removed first. Pure data and no server dependencies: safe to import
 * from the storefront proxy (`@altyapi/site/route-classes`).
 */

/** First path segments served per visitor outside the module route table. */
const PRIVATE_PLATFORM_SEGMENTS: ReadonlySet<string> = new Set(["api", "account", "preview", "admin"]);

/** Every language path of every module route, longest first. */
const ROUTE_PATHS: readonly { path: string; route: ModuleRouteDef }[] = SITE_MODULE_MANIFESTS.flatMap((m) =>
  (m.routes as readonly ModuleRouteDef[]).flatMap((route) =>
    [route.path, ...Object.values(route.localizedPaths ?? {})].filter((p): p is string => !!p).map((path) => ({ path, route })),
  ),
).sort((a, b) => b.path.length - a.path.length);

/** Class of routes no module owns: pages, content type routes, not-found. */
const DEFAULT_CACHE_CLASS: RouteCacheClass =
  SITE_MODULE_MANIFESTS.flatMap((m) => ("dynamicRoutes" in m ? (m.dynamicRoutes ?? []) : [])).find((r) => r.source === "content_types")?.cacheClass ?? "public";

/** Cache class of a request path ("/en/cart" → private, "/hizmetler/web" → public). */
export function cacheClassOfPath(pathname: string): RouteCacheClass {
  const segments = (pathname.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
  const rest = segments.length > 0 && isLocaleCode(segments[0]!) ? segments.slice(1) : segments;
  if (rest.length > 0 && PRIVATE_PLATFORM_SEGMENTS.has(rest[0]!.toLowerCase())) return "private";
  const path = `/${rest.join("/")}`;
  const owner = ROUTE_PATHS.find(({ path: own, route }) => path === own || (route.match === "prefix" && own !== "/" && path.startsWith(`${own}/`)));
  return owner ? owner.route.cacheClass : DEFAULT_CACHE_CLASS;
}
