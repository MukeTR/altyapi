import type { EffectiveContentType } from "./types/definition";
import { typePrefixFor } from "./types/definition";

/**
 * Storefront paths of content. The default language has no prefix; other languages are
 * served under /{locale} (the same rule as the rest of the storefront).
 */
export function localizedPath(locale: string, defaultLocale: string, path: string): string {
  return locale === defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}

/** Path of a type's index route in a language (null when the type has no routes). */
export function typeIndexPath(type: Pick<EffectiveContentType, "routePrefix">, locale: string, defaultLocale: string): string | null {
  const prefix = typePrefixFor(type, locale);
  return prefix ? localizedPath(locale, defaultLocale, `/${prefix}`) : null;
}

/**
 * Path of an entry in a language: /{prefix}/{slug} for collections, the type's own route for
 * a singleton. Null when the type has no routes or the entry has no slug in that language.
 */
export function entryPath(type: Pick<EffectiveContentType, "routePrefix" | "kind">, locale: string, defaultLocale: string, slug: string | null | undefined): string | null {
  const prefix = typePrefixFor(type, locale);
  if (!prefix) return null;
  if (type.kind === "singleton") return localizedPath(locale, defaultLocale, `/${prefix}`);
  return slug ? localizedPath(locale, defaultLocale, `/${prefix}/${slug}`) : null;
}

/** Archive path of a taxonomy term under an owner type (/blog/kategori/{slug}). */
export function termArchivePath(
  owner: Pick<EffectiveContentType, "routePrefix" | "taxonomies">,
  taxonomyBuiltinKey: string,
  locale: string,
  defaultLocale: string,
  slug: string,
): string | null {
  const prefix = typePrefixFor(owner, locale);
  const binding = owner.taxonomies.find((t) => t.typeKey === taxonomyBuiltinKey);
  const segment = binding ? (binding.archiveSegment as Record<string, string>)[locale] ?? binding.archiveSegment.en : null;
  if (!prefix || !segment) return null;
  return localizedPath(locale, defaultLocale, `/${prefix}/${segment}/${slug}`);
}

const SAME_SITE_BASE = "https://site.invalid";

/**
 * True for a path on the site itself (canonical paths, internal links): starts with a single
 * "/", holds no backslash, whitespace or control character, and resolves against any origin
 * to that same origin. Browsers and URL resolvers read "//host", "/\host" and "/\t/host" as
 * another host, which would hand the page's canonical (and its ranking) to that domain.
 */
export function isSameSitePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (/[\\\s\u0000-\u001f\u007f]/.test(path)) return false;
  try {
    return new URL(path, SAME_SITE_BASE).origin === SAME_SITE_BASE;
  } catch {
    return false;
  }
}

const PREFIX_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

export function isValidPrefix(prefix: string): boolean {
  return prefix.length <= 100 && PREFIX_RE.test(prefix);
}
