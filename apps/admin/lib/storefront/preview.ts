import type { PageType, StorefrontPage } from "./types";

/** Records used to preview templates that need one (a product page needs a product). */
export interface PreviewSamples {
  productHandle: string | null;
  collectionHandle: string | null;
}

export type PreviewTarget = { ok: true; path: string } | { ok: false; reason: "needs_product" };

/** A path that is certainly not a page, to preview the 404 template. */
const NOT_FOUND_PATH = "/sayfa-bulunamadi-onizleme";

/**
 * Storefront path showing a page's draft. Pages use their draft handle (a rename exists only in
 * preview until published); templates are previewed on a real record URL.
 */
export function previewTarget(page: Pick<StorefrontPage, "type" | "handle" | "draftPath">, samples: PreviewSamples): PreviewTarget {
  const type: PageType = page.type;
  switch (type) {
    case "home":
      return { ok: true, path: "/" };
    case "page":
    case "landing":
      return { ok: true, path: page.draftPath ?? `/pages/${page.handle}` };
    case "product":
      return samples.productHandle ? { ok: true, path: `/products/${encodeURIComponent(samples.productHandle)}` } : { ok: false, reason: "needs_product" };
    case "collection":
      return { ok: true, path: `/collections/${encodeURIComponent(samples.collectionHandle ?? "all")}` };
    case "cart":
      return { ok: true, path: "/cart" };
    case "search":
      return { ok: true, path: "/search" };
    case "not_found":
      return { ok: true, path: NOT_FOUND_PATH };
    default:
      return { ok: true, path: "/" };
  }
}

/** Adds the language prefix the storefront uses for every language but the default one. */
export function localizedPath(path: string, locale: string, defaultLocale: string): string {
  if (locale === defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** URL that switches the visitor's browser into preview mode (the token is store-bound and valid for one hour). */
export function previewUrl(origin: string, path: string, token: string, extra?: Record<string, string>): string {
  const url = new URL(path, `${origin}/`);
  url.searchParams.set("preview_token", token);
  for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
  return url.toString();
}
