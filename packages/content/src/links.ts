import { z } from "zod";

/**
 * Link targets of rich text marks, CTA nodes and link fields (plan §3.4). Internal targets
 * are stored by id, never by path, so renames and slug changes never break a link; they are
 * rendered as tokens ("alt:entry/{id}") that are resolved to live URLs at render time, and an
 * internal target that is not live renders as plain text.
 */

/** Records an internal link can point at. */
export const INTERNAL_LINK_KINDS = ["page", "entry", "product", "collection"] as const;
export type InternalLinkKind = (typeof INTERNAL_LINK_KINDS)[number];

/** Kinds of internal tokens in derived HTML and Markdown: link targets plus assets. */
export type TokenKind = InternalLinkKind | "asset";

const E164 = /^\+[1-9]\d{6,14}$/;

/** Phone number in E.164 ("+905321234567"). */
export const e164Phone = z.string().trim().regex(E164, "errors.content.invalid_phone");

/**
 * External URL of a link target: https, mailto or tel only. Plain http is refused (mixed
 * content, and links in published content should not downgrade visitors), and so is anything
 * with whitespace or control characters.
 */
export const externalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.protocol === "https:") return url.hostname.length > 0 && !url.username && !url.password;
    if (url.protocol === "mailto:") return /^mailto:[^@]+@[^@]+\.[^@]+$/.test(value);
    if (url.protocol === "tel:") return /^tel:\+?[0-9-]{3,20}$/.test(value);
    return false;
  }, "errors.content.invalid_url");

/** https URL only (citations, sources, statistic sources). */
export const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "errors.content.invalid_url");

/** In-page anchor (heading ids are generated the same way). */
export const anchorId = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "errors.content.invalid_anchor");

export const linkTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url"), url: externalUrl }),
  z.object({ type: z.literal("page"), id: z.uuid() }),
  z.object({ type: z.literal("entry"), id: z.uuid() }),
  z.object({ type: z.literal("product"), id: z.uuid() }),
  z.object({ type: z.literal("collection"), id: z.uuid() }),
  z.object({ type: z.literal("anchor"), anchor: anchorId }),
  z.object({ type: z.literal("whatsapp"), phone: e164Phone, text: z.string().max(500).optional() }),
  z.object({ type: z.literal("tel"), phone: e164Phone }),
]);

export type LinkTarget = z.infer<typeof linkTargetSchema>;

export const TOKEN_SCHEME = "alt:";

/** Token of an internal record in derived output ("alt:entry/{id}"). */
export function internalToken(kind: TokenKind, id: string): string {
  return `${TOKEN_SCHEME}${kind}/${id}`;
}

export function isInternalTarget(target: LinkTarget): target is Extract<LinkTarget, { type: InternalLinkKind }> {
  return (INTERNAL_LINK_KINDS as readonly string[]).includes(target.type);
}

/**
 * href of a link target. Internal targets become tokens unless a resolver is given; with a
 * resolver, an internal target that does not resolve (not live, deleted) returns null.
 */
export function linkTargetHref(target: LinkTarget, resolve?: (kind: InternalLinkKind, id: string) => string | null): string | null {
  switch (target.type) {
    case "url":
      return target.url;
    case "anchor":
      return `#${target.anchor}`;
    case "tel":
      return `tel:${target.phone}`;
    case "whatsapp": {
      const base = `https://wa.me/${target.phone.slice(1)}`;
      return target.text ? `${base}?text=${encodeURIComponent(target.text)}` : base;
    }
    default:
      return resolve ? resolve(target.type, target.id) : internalToken(target.type, target.id);
  }
}

/** True for targets that leave the site (rendered with rel="noopener noreferrer" when opened in a new tab). */
export function isExternalTarget(target: LinkTarget): boolean {
  return target.type === "url" || target.type === "whatsapp";
}
