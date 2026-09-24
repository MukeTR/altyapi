import "server-only";
import type { SiteDto } from "@altyapi/theme-engine";
import { fetchSitemap, type SitemapData } from "./api";
import type { Tenant } from "./tenant";
import { localizedPath } from "./format";

export const SITEMAP_CHUNK = 5000;

export function origin(site: SiteDto, tenant: Tenant): string {
  return `https://${site.canonicalHost || tenant.host}`;
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export interface UrlEntry {
  loc: string;
  lastmod: string;
  alternates: Record<string, string>;
}

/** Groups localized handles of the same resource so each URL lists its hreflang alternates. */
export function buildEntries(data: SitemapData, kind: "products" | "collections" | "pages", base: string): UrlEntry[] {
  if (kind === "pages") {
    return data.pages.map((p) => {
      const path = p.type === "home" ? "/" : `/pages/${p.handle}`;
      const alternates = Object.fromEntries(data.supportedLocales.map((l) => [l, `${base}${localizedPath(l, data.defaultLocale, path)}`]));
      return { loc: `${base}${path}`, lastmod: p.updatedAt, alternates };
    });
  }
  const rows = kind === "products" ? data.products : data.collections;
  const prefix = kind === "products" ? "/products/" : "/collections/";
  // Rows are one per (resource, locale); the default-locale row defines the entry.
  return rows
    .filter((r) => r.locale === data.defaultLocale)
    .map((r) => ({
      loc: `${base}${prefix}${r.handle}`,
      lastmod: r.updatedAt,
      alternates: { [data.defaultLocale]: `${base}${prefix}${r.handle}` },
    }));
}

export function urlset(entries: UrlEntry[]): string {
  const body = entries
    .map(
      (e) =>
        `<url><loc>${xmlEscape(e.loc)}</loc><lastmod>${new Date(e.lastmod).toISOString()}</lastmod>${Object.entries(e.alternates)
          .map(([l, href]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(href)}"/>`)
          .join("")}</url>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`;
}

export async function loadSitemap(tenant: Tenant) {
  return fetchSitemap(tenant);
}
