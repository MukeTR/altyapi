export { slugify } from "@/lib/slug";
import type { ContentTypeKind, ContentTypeSummary, FieldDef, LocalizedText } from "./types";

/**
 * Small helpers shared by the content screens: localized labels, localized value maps, entry
 * paths (the same rules as packages/content/src/paths.ts) and issue paths.
 */

/** Text of a localized label in the interface language, falling back to Turkish, then any. */
export function labelText(map: LocalizedText | undefined | null, uiLocale: string, fallback = ""): string {
  if (!map) return fallback;
  return map[uiLocale] || map.tr || map.en || Object.values(map).find((v) => v) || fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A localized map with one language set, or removed when the value is empty. */
export function withLocale(map: unknown, locale: string, next: unknown): Record<string, unknown> | null {
  const copy = { ...asRecord(map) };
  if (next === undefined || next === null || next === "") delete copy[locale];
  else copy[locale] = next;
  return Object.keys(copy).length ? copy : null;
}

/** Value of a field in one language (the value itself for non-localized fields). */
export function valueIn(field: Pick<FieldDef, "localized">, value: unknown, locale: string): unknown {
  return field.localized ? asRecord(value)[locale] : value;
}

/** URL prefix of a type in a language: the stored one, else English, else any (typePrefixFor). */
export function typePrefixFor(routePrefix: Record<string, string>, locale: string): string | null {
  if (!Object.keys(routePrefix).length) return null;
  return routePrefix[locale] ?? routePrefix.en ?? Object.values(routePrefix)[0] ?? null;
}

export function localizedPath(locale: string, defaultLocale: string, path: string): string {
  return locale === defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}

/** Storefront path of an entry in a language, or null when it has none (no routes or no slug). */
export function entryPath(type: { routePrefix: Record<string, string>; kind: ContentTypeKind }, locale: string, defaultLocale: string, slug: string | null | undefined): string | null {
  const prefix = typePrefixFor(type.routePrefix, locale);
  if (!prefix) return null;
  if (type.kind === "singleton") return localizedPath(locale, defaultLocale, `/${prefix}`);
  return slug ? localizedPath(locale, defaultLocale, `/${prefix}/${slug}`) : null;
}

/** Index path of a type in a language (null without routes). */
export function typeIndexPath(type: Pick<ContentTypeSummary, "routePrefix">, locale: string, defaultLocale: string): string | null {
  const prefix = typePrefixFor(type.routePrefix, locale);
  return prefix ? localizedPath(locale, defaultLocale, `/${prefix}`) : null;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Well-formed URL prefix: up to three lower-case segments (isValidPrefix). */
export const PREFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

/** Sections of the entry editor a field belongs to. */
export function sectionOf(field: FieldDef): "main" | "geo" | string {
  return field.ui?.section ?? "main";
}
