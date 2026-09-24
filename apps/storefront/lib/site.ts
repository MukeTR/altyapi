import "server-only";
import { cache } from "react";
import type { SiteDto } from "@altyapi/theme-engine";
import type { StorefrontSite } from "./tracking-types";
import { fetchSite } from "./api";
import { getTenant, localeFromPath } from "./tenant";
import type { RenderCtx } from "@/components/context";

/** Site for the current request in the locale implied by the path (memoized per request). */
export const getSite = cache(async (): Promise<{ site: StorefrontSite; tenant: Awaited<ReturnType<typeof getTenant>> }> => {
  const tenant = await getTenant();
  const base = await fetchSite(tenant);
  const locale = localeFromPath(tenant.path, base.supportedLocales, base.defaultLocale);
  const site = locale === base.locale ? base : await fetchSite(tenant, locale);
  return { site, tenant };
});

export function renderCtx(site: SiteDto, route: RenderCtx["route"], searchParams: URLSearchParams): RenderCtx {
  return {
    site,
    route,
    locale: site.locale,
    defaultLocale: site.defaultLocale,
    currency: site.currency,
    mediaBase: site.mediaBaseUrl,
    searchParams,
  };
}

export function fontHref(site: SiteDto): string | null {
  const fonts = [...new Set([site.theme.settings.typography.headingFont, site.theme.settings.typography.bodyFont])].filter((f) => f !== "system");
  if (!fonts.length) return null;
  // Bunny Fonts: privacy-friendly Google Fonts mirror (no visitor IP sharing with Google).
  return `https://fonts.bunny.net/css?family=${fonts.map((f) => `${f.toLowerCase().replace(/ /g, "-")}:400,500,600,700`).join("|")}&display=swap`;
}
