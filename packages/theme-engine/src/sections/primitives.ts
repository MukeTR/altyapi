import { z } from "zod";
import sanitizeHtml from "sanitize-html";

export const LOCALES = ["tr", "en"] as const;

/** Localized short text. Keys are locale codes; missing locales fall back to the store default. */
export const localized = (max = 300) => z.partialRecord(z.enum(LOCALES), z.string().max(max)).default({});

/** Allow-listed rich text; sanitized on save so stored HTML is always safe to render. */
export const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "span", "hr"],
  allowedAttributes: { a: ["href", "target", "rel"], span: ["class"] },
  allowedSchemes: ["https", "http", "mailto", "tel"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: attribs.target === "_blank" ? "noopener noreferrer" : attribs.rel ?? "" },
    }),
  },
};

export const richText = (max = 20_000) =>
  z
    .partialRecord(z.enum(LOCALES), z.string().max(max).transform((html) => sanitizeHtml(html, RICH_TEXT_OPTIONS)))
    .default({});

/** Internal path ("/collections/yeni") or absolute https URL. */
export const href = z
  .string()
  .max(2000)
  .refine((v) => v.startsWith("/") || /^https?:\/\//.test(v) || v.startsWith("mailto:") || v.startsWith("tel:"), "errors.section.invalid_link")
  .refine((v) => !/^\/\//.test(v), "errors.section.invalid_link");

export const link = z.object({
  label: localized(80),
  href,
  openInNewTab: z.boolean().default(false),
});

export const assetId = z.uuid();
export const optionalAsset = z.uuid().nullable().default(null);

export const alignment = z.enum(["left", "center", "right"]);
export const colorScheme = z.enum(["default", "inverse", "accent", "muted"]).default("default");
