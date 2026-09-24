import sanitizeHtml from "sanitize-html";

/** Tags that load third-party media: allowed in catalog descriptions only. */
const MEDIA_TAGS = ["img", "figure", "figcaption"];

/**
 * The single allow-list for stored rich text, in two profiles that differ only in media.
 * Stored HTML is always sanitized with its profile on save, so the storefront can render it
 * as is.
 *
 * - Headings start at h2: every page has exactly one H1, owned by the page itself, so a
 *   pasted h1 is demoted to h2 instead of competing with it.
 * - Links: https/http/mailto/tel only, never protocol-relative; a new tab always gets
 *   rel="noopener noreferrer".
 * - Span classes are limited to the `rt-` namespace so content cannot pull storefront
 *   utility classes (fixed overlays, z-index, hidden) into the page.
 */
const BASE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "h4", "h5",
    "blockquote", "span", "hr", "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    span: ["class"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  allowedClasses: { span: [/^rt-[a-z0-9-]{1,40}$/] },
  allowedSchemes: ["https", "http", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    h1: "h2",
    a: (tagName, attribs) => {
      const next = { ...attribs };
      if (next.target !== undefined && next.target !== "_blank") delete next.target;
      if (next.target === "_blank") {
        // A new tab must not get a handle on this window (reverse tabnabbing).
        const rel = new Set((next.rel ?? "").split(/\s+/).filter(Boolean));
        rel.add("noopener");
        rel.add("noreferrer");
        next.rel = [...rel].join(" ");
      }
      return { tagName, attribs: next };
    },
  },
};

/**
 * Design content (section rich text, including global sections on every page such as the
 * footer and consent texts): no images. An image in design content would load from any host
 * before consent, which is how tracking pixels get around the protected tracking layer;
 * images in content come as asset references instead.
 */
export const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = BASE_OPTIONS;

/**
 * Product and collection descriptions: the same list plus images, figures and captions for
 * specifications and imported catalog text. Images load over https only; an image whose
 * source was rejected (http, protocol-relative, data:) is dropped rather than rendered broken.
 */
export const DESCRIPTION_HTML_OPTIONS: sanitizeHtml.IOptions = {
  ...BASE_OPTIONS,
  allowedTags: [...(BASE_OPTIONS.allowedTags as string[]), ...MEDIA_TAGS],
  allowedAttributes: { ...(BASE_OPTIONS.allowedAttributes as Record<string, string[]>), img: ["src", "alt", "width", "height"] },
  allowedSchemesByTag: { img: ["https"] },
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};

/** Rich text of design content (sections). */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS);
}

/** Rich text of catalog descriptions (products, collections). */
export function sanitizeDescriptionHtml(html: string): string {
  return sanitizeHtml(html, DESCRIPTION_HTML_OPTIONS);
}

/** True when HTML carries an image tag (design content rejects them instead of dropping them silently). */
export function containsImageTag(html: string): boolean {
  return /<\s*img\b/i.test(html);
}

/** Plain text of an HTML fragment with whitespace collapsed (summaries, feeds, search). */
export function htmlToPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}
