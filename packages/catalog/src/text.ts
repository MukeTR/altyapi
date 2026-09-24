import { htmlToPlainText, sanitizeDescriptionHtml } from "@altyapi/content";

/** Product/collection descriptions use the platform rich-text allow-list in its catalog profile (with images). */
export function sanitizeDescription(html: string): string {
  return sanitizeDescriptionHtml(html);
}

export function stripHtml(html: string): string {
  return htmlToPlainText(html);
}

const TR_FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", i̇: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/**
 * Normalization shared by indexing and querying so "Çanta", "canta" and "ÇANTA" match.
 * Uses Turkish lower-casing first (İ → i, I → ı), then folds diacritics.
 */
export function searchNormalize(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]|i̇/g, (c) => TR_FOLD[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Builds a prefix tsquery ("kirmizi:* & canta:*") from free text; returns null for empty input. */
export function toPrefixTsQuery(q: string): string | null {
  const terms = searchNormalize(q)
    .split(" ")
    .filter((t) => t.length > 0)
    .slice(0, 8)
    .map((t) => `${t}:*`);
  return terms.length ? terms.join(" & ") : null;
}

/** Storefront path in a locale: the default locale has no prefix, and a prefixed home is `/en`, not `/en/` (which redirects). */
export function localizedPath(locale: string, defaultLocale: string, path: string): string {
  return locale === defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}
