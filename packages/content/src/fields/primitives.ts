import { z } from "zod";
import { LOCALE_CODES } from "@altyapi/commerce-core";
import { containsImageTag, sanitizeRichText } from "../rich/sanitize";

/** Locale keys accepted in localized fields: the platform locale registry. */
export const LOCALES = LOCALE_CODES;

/** Localized short text. Keys are locale codes; missing locales fall back to the store default. */
export const localized = (max = 300) => z.partialRecord(z.enum(LOCALES), z.string().max(max)).default({});

/**
 * Allow-listed rich text of design content; sanitized on save so stored HTML is always safe
 * to render. Images are refused with an error rather than dropped, so a pasted image (or a
 * tracking pixel snippet) never disappears silently.
 */
export const richText = (max = 20_000) =>
  z
    .partialRecord(
      z.enum(LOCALES),
      z
        .string()
        .max(max)
        .refine((html) => !containsImageTag(html), "errors.section.image_not_allowed")
        .transform(sanitizeRichText),
    )
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
