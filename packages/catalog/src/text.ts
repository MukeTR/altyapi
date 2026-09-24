import sanitizeHtml from "sanitize-html";

/** Product/collection descriptions allow a wider tag set than section rich text (tables, images). */
export const DESCRIPTION_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "h4", "h5",
    "blockquote", "span", "hr", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption",
  ],
  allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
  allowedSchemes: ["https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"] },
};

export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, DESCRIPTION_HTML_OPTIONS);
}

export function stripHtml(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
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

export function localizedPath(locale: string, defaultLocale: string, path: string): string {
  return locale === defaultLocale ? path : `/${locale}${path}`;
}
