import type { ResolvedRoute, SiteDto } from "@altyapi/theme-engine";
import { localized, localizedPath } from "@/lib/format";

/** Everything a section renderer needs besides its own props. */
export interface RenderCtx {
  site: SiteDto;
  route: ResolvedRoute | null;
  locale: string;
  defaultLocale: string;
  currency: string;
  mediaBase: string | null;
  searchParams: URLSearchParams;
}

export const L = (ctx: RenderCtx, map: unknown) => localized(map, ctx.locale, ctx.defaultLocale);
export const P = (ctx: RenderCtx, path: string) => (path.startsWith("/") ? localizedPath(ctx.locale, ctx.defaultLocale, path) : path);

/**
 * Whether a capability module is active for the site. An API that predates site modules
 * (during a rollout) sends no list; every store then was an online store with everything on.
 */
export function moduleOn(site: Pick<SiteDto, "modules">, module: string): boolean {
  return (site.modules ?? ["core", "content", "catalog", "commerce"]).includes(module as SiteDto["modules"][number]);
}
