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
