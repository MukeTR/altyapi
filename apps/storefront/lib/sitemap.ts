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

export type SitemapKind = "pages" | "products" | "collections";

export interface UrlEntry {
  loc: string;
  /** When the published content last changed (ISO 8601). */
  lastmod: string;
  /** hreflang → absolute URL, including the entry itself and x-default; empty for single-language URLs. */
  alternates: Record<string, string>;
}

/** One entry per language URL of a resource; each carries the full hreflang set (plus x-default) when there is more than one. */
function addResource(entries: UrlEntry[], urls: Record<string, string>, defaultLocale: string, lastmod: string): void {
  const locales = Object.keys(urls);
  const xDefault = urls[defaultLocale];
  const alternates = locales.length > 1 ? { ...urls, ...(xDefault ? { "x-default": xDefault } : {}) } : {};
  for (const l of locales) entries.push({ loc: urls[l]!, lastmod, alternates });
}

/**
 * One entry per published URL, sorted by URL so chunk boundaries are stable between requests.
 * Every resource is listed in each supported language it has content in (pages: their own
 * title or SEO title; products and collections: a translation), with the resource's hreflang set.
 */
export function buildEntries(data: SitemapData, kind: SitemapKind, base: string): UrlEntry[] {
  const supported = new Set(data.supportedLocales);
  const url = (locale: string, path: string) => `${base}${localizedPath(locale, data.defaultLocale, path)}`;
  const entries: UrlEntry[] = [];
  if (kind === "pages") {
    for (const p of data.pages) {
      const path = p.type === "home" ? "/" : `/pages/${p.handle}`;
      const locales = (p.locales ?? [data.defaultLocale]).filter((l) => supported.has(l));
      addResource(entries, Object.fromEntries(locales.map((l) => [l, url(l, path)])), data.defaultLocale, p.updatedAt);
    }
  } else {
    const prefix = kind === "products" ? "/products/" : "/collections/";
    const byResource = new Map<string, { urls: Record<string, string>; lastmod: string }>();
    for (const r of kind === "products" ? data.products : data.collections) {
      if (!supported.has(r.locale)) continue;
      const key = r.id ?? `${r.locale}:${r.handle}`;
      const group = byResource.get(key) ?? { urls: {}, lastmod: r.updatedAt };
      group.urls[r.locale] = url(r.locale, `${prefix}${r.handle}`);
      byResource.set(key, group);
    }
    for (const g of byResource.values()) addResource(entries, g.urls, data.defaultLocale, g.lastmod);
  }
  return entries.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
}

/** Entries of one numbered sitemap file (1-based). */
export function chunkOf(entries: UrlEntry[], chunk: number): UrlEntry[] {
  return entries.slice((chunk - 1) * SITEMAP_CHUNK, chunk * SITEMAP_CHUNK);
}

export interface SitemapFile {
  name: string;
  /** Newest lastmod of the file's entries; null for an empty file. */
  lastmod: string | null;
}

/**
 * Child files of the sitemap index. Each file's lastmod is the newest change among its own
 * URLs, never the request time. pages-1.xml is always listed so the index is never empty.
 */
export function sitemapFiles(data: SitemapData, base: string): SitemapFile[] {
  const files: SitemapFile[] = [];
  for (const kind of ["pages", "products", "collections"] as const) {
    const entries = buildEntries(data, kind, base);
    const count = Math.max(kind === "pages" ? 1 : 0, Math.ceil(entries.length / SITEMAP_CHUNK));
    for (let chunk = 1; chunk <= count; chunk++) {
      const times = chunkOf(entries, chunk).map((e) => Date.parse(e.lastmod)).filter((t) => !Number.isNaN(t));
      files.push({ name: `${kind}-${chunk}.xml`, lastmod: times.length ? new Date(Math.max(...times)).toISOString() : null });
    }
  }
  return files;
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

export async function loadSitemap(site: SiteDto, tenant: Tenant): Promise<SitemapData> {
  return fetchSitemap(tenant, site.contentVersion);
}
