import "server-only";
import type { ResolvedRoute } from "@altyapi/theme-engine";
import type { StorefrontSite } from "./tracking-types";
import { serverEnv } from "./env";
import type { Tenant } from "./tenant";

export class StorefrontApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function tenantHeaders(t: Tenant): Record<string, string> {
  return {
    "x-altyapi-storefront-key": serverEnv.storefrontApiSecret(),
    ...(t.storeId ? { "x-altyapi-store-id": t.storeId } : {}),
    ...(!t.storeId && t.devHost ? { "x-altyapi-dev-host": t.devHost } : {}),
    ...(t.previewToken ? { "x-altyapi-preview-token": t.previewToken } : {}),
  };
}

async function sfFetch<T>(t: Tenant, path: string, params: URLSearchParams, revalidate: number): Promise<T> {
  const url = `${serverEnv.apiUrl()}${path}?${params.toString()}`;
  const tag = `store:${t.storeId ?? t.devHost}`;
  const res = await fetch(url, {
    headers: tenantHeaders(t),
    // Preview renders drafts and must never be cached; live data is cached by URL (which carries the content version).
    ...(t.previewToken ? { cache: "no-store" as const } : { next: { revalidate, tags: [tag] } }),
  });
  if (!res.ok) throw new StorefrontApiError(res.status, `Storefront API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export function fetchSite(t: Tenant, locale?: string): Promise<StorefrontSite> {
  const params = new URLSearchParams();
  if (locale) params.set("locale", locale);
  return sfFetch<StorefrontSite>(t, "/storefront/v1/site", params, 10);
}

export function fetchRoute(t: Tenant, site: StorefrontSite, path: string, query: URLSearchParams): Promise<ResolvedRoute> {
  const params = new URLSearchParams(query);
  params.delete("path");
  params.set("path", path);
  params.set("locale", site.locale);
  // The content version makes every publish produce new cache keys (versioned invalidation).
  params.set("v", String(site.contentVersion));
  params.sort();
  return sfFetch<ResolvedRoute>(t, "/storefront/v1/route", params, 60);
}

/**
 * Payload of GET /storefront/v1/sitemap. Product and collection rows are one per translation,
 * grouped by id; pages carry the languages they have content of their own in. Fields marked
 * optional may be absent while an older API version is still serving during a rollout.
 */
export interface SitemapData {
  defaultLocale: string;
  supportedLocales: string[];
  products: { id?: string; handle: string; locale: string; updatedAt: string }[];
  collections: { id?: string; handle: string; locale: string; updatedAt: string }[];
  pages: { type: string; handle: string; updatedAt: string; locales?: string[] }[];
}

/** Cached per content version, so a publish or catalog change shows up in the sitemap right away. */
export function fetchSitemap(t: Tenant, contentVersion: number): Promise<SitemapData> {
  return sfFetch<SitemapData>(t, "/storefront/v1/sitemap", new URLSearchParams({ v: String(contentVersion) }), 3600);
}
