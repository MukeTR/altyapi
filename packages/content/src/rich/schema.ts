import { z } from "zod";
import { CONTENT_LIMITS } from "../limits";
import { httpsUrl, linkTargetSchema, type LinkTarget } from "../links";

/**
 * richDoc (docs/platform/site-turleri-ve-cms.md §3.4): the single format of every new rich
 * text field. A ProseMirror/Tiptap compatible JSON tree per locale, validated against a node
 * allow-list. There is no raw HTML node, no URL-based embed and no iframe: third-party media
 * are stored as provider + id and rendered as consent-gated placeholders, images as asset
 * references, internal links by record id.
 */

export const RICH_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "table",
  "image",
  "callout",
  "statistic",
  "quote",
  "faqGroup",
  "cta",
  "entryEmbed",
  "productEmbed",
  "embed",
] as const;
export type RichBlockType = (typeof RICH_BLOCK_TYPES)[number];

export const RICH_MARK_TYPES = ["bold", "italic", "underline", "strike", "code", "citation", "link"] as const;
export type RichMarkType = (typeof RICH_MARK_TYPES)[number];

export const EMBED_PROVIDERS = ["youtube", "vimeo", "google_maps", "spotify"] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

/** Provider ids: never a URL, so no arbitrary host can be embedded. */
const EMBED_ID_PATTERNS: Record<EmbedProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^\d{6,12}$/,
  /** Google place id. */
  google_maps: /^[A-Za-z0-9_-]{16,512}$/,
  /** "{kind}/{id}", e.g. "episode/4rOoJ6Egrf8K2IrywzwOMk". */
  spotify: /^(?:track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{22}$/,
};

export function isValidEmbedId(provider: EmbedProvider, id: string): boolean {
  return EMBED_ID_PATTERNS[provider].test(id);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RichMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "code" }
  /** Marks a claim as quoted from a source (rendered as <cite>, listed with the source in Markdown). */
  | { type: "citation"; attrs: { title: string; url?: string | undefined } }
  | { type: "link"; attrs: { target: LinkTarget; openInNewTab?: boolean | undefined; rel?: ("nofollow" | "sponsored" | "ugc")[] | undefined } };

export interface RichTextNode {
  type: "text";
  text: string;
  marks?: RichMark[] | undefined;
}
export interface RichHardBreak {
  type: "hardBreak";
}
export type RichInline = RichTextNode | RichHardBreak;

export interface RichParagraph {
  type: "paragraph";
  content?: RichInline[] | undefined;
}
export interface RichHeading {
  type: "heading";
  /** h1 belongs to the page; content headings are h2–h4. */
  attrs: { level: 2 | 3 | 4 };
  content?: RichInline[] | undefined;
}
export type RichListItemChild = RichParagraph | RichBulletList | RichOrderedList;
export interface RichListItem {
  type: "listItem";
  content: RichListItemChild[];
}
export interface RichBulletList {
  type: "bulletList";
  content: RichListItem[];
}
export interface RichOrderedList {
  type: "orderedList";
  attrs?: { start?: number | undefined } | undefined;
  content: RichListItem[];
}
/** Blocks allowed inside quotes, callouts and FAQ answers. */
export type RichFlowBlock = RichParagraph | RichBulletList | RichOrderedList;
export interface RichBlockquote {
  type: "blockquote";
  content: RichFlowBlock[];
}
export interface RichTableCell {
  type: "tableCell" | "tableHeader";
  attrs?: { colspan?: number | undefined; rowspan?: number | undefined } | undefined;
  content: RichParagraph[];
}
export interface RichTableRow {
  type: "tableRow";
  content: RichTableCell[];
}
/** The first row is the header row (all tableHeader cells). */
export interface RichTable {
  type: "table";
  content: RichTableRow[];
}
export interface RichImage {
  type: "image";
  /** alt is required on publish unless the image is marked decorative. */
  attrs: { assetId: string; alt?: string | undefined; decorative?: boolean | undefined; caption?: string | undefined; width?: "normal" | "wide" | "full" | undefined };
}
export interface RichCallout {
  type: "callout";
  attrs: { tone: "info" | "note" | "success" | "warning" };
  content: RichFlowBlock[];
}
export interface StatisticSource {
  title: string;
  url?: string | undefined;
  publisher?: string | undefined;
  /** YYYY-MM-DD or YYYY-MM or YYYY. */
  date?: string | undefined;
}
/** A number with its source; the source is required on publish. */
export interface RichStatistic {
  type: "statistic";
  attrs: { value: string; label: string; source?: StatisticSource | undefined };
}
/** A pull quote with attribution (blockquote is for quoted passages). */
export interface RichQuote {
  type: "quote";
  attrs: { text: string; attribution?: string | undefined; role?: string | undefined; sourceUrl?: string | undefined };
}
export interface RichFaqItem {
  type: "faqItem";
  attrs: { question: string };
  content: RichFlowBlock[];
}
export interface RichFaqGroup {
  type: "faqGroup";
  content: RichFaqItem[];
}
export interface RichCta {
  type: "cta";
  attrs: { label: string; target: LinkTarget; variant: "primary" | "secondary" };
}
export interface RichEntryEmbed {
  type: "entryEmbed";
  attrs: { entryId: string };
}
export interface RichProductEmbed {
  type: "productEmbed";
  attrs: { productId: string };
}
export interface RichEmbed {
  type: "embed";
  attrs: { provider: EmbedProvider; id: string; title?: string | undefined; start?: number | undefined };
}

export type RichBlock =
  | RichParagraph
  | RichHeading
  | RichBulletList
  | RichOrderedList
  | RichBlockquote
  | RichTable
  | RichImage
  | RichCallout
  | RichStatistic
  | RichQuote
  | RichFaqGroup
  | RichCta
  | RichEntryEmbed
  | RichProductEmbed
  | RichEmbed;

export interface RichDoc {
  type: "doc";
  content: RichBlock[];
}

export function emptyRichDoc(): RichDoc {
  return { type: "doc", content: [] };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const shortText = (max: number) => z.string().trim().max(max);

const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("citation"), attrs: z.object({ title: shortText(300).min(1), url: httpsUrl.optional() }) }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({
      target: linkTargetSchema,
      openInNewTab: z.boolean().optional(),
      rel: z.array(z.enum(["nofollow", "sponsored", "ugc"])).max(3).optional(),
    }),
  }),
]);

const textNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(20_000),
  marks: z.array(markSchema).max(8).optional(),
});
const inlineSchema = z.discriminatedUnion("type", [textNodeSchema, z.object({ type: z.literal("hardBreak") })]);
const inlineContent = z.array(inlineSchema).max(5_000).optional();

const paragraphSchema = z.object({ type: z.literal("paragraph"), content: inlineContent });
const headingSchema = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3), z.literal(4)]) }),
  content: inlineContent,
});

const listItemSchema = z.object({
  type: z.literal("listItem"),
  content: z.array(z.lazy((): z.ZodType<RichListItemChild> => listItemChildSchema)).min(1).max(20),
});
const bulletListSchema = z.object({ type: z.literal("bulletList"), content: z.array(listItemSchema).min(1).max(500) });
const orderedListSchema = z.object({
  type: z.literal("orderedList"),
  attrs: z.object({ start: z.number().int().min(0).max(1_000_000).optional() }).optional(),
  content: z.array(listItemSchema).min(1).max(500),
});
const listItemChildSchema = z.discriminatedUnion("type", [paragraphSchema, bulletListSchema, orderedListSchema]);
const flowContent = z.array(z.discriminatedUnion("type", [paragraphSchema, bulletListSchema, orderedListSchema])).min(1).max(200);

const cellSchema = z.object({
  type: z.enum(["tableCell", "tableHeader"]),
  attrs: z
    .object({ colspan: z.number().int().min(1).max(20).optional(), rowspan: z.number().int().min(1).max(200).optional() })
    .optional(),
  content: z.array(paragraphSchema).min(1).max(20),
});
const tableSchema = z.object({
  type: z.literal("table"),
  content: z.array(z.object({ type: z.literal("tableRow"), content: z.array(cellSchema).min(1).max(20) })).min(1).max(200),
});

const imageSchema = z.object({
  type: z.literal("image"),
  attrs: z.object({
    assetId: z.uuid(),
    alt: shortText(300).optional(),
    decorative: z.boolean().optional(),
    caption: shortText(500).optional(),
    width: z.enum(["normal", "wide", "full"]).optional(),
  }),
});

const statisticSchema = z.object({
  type: z.literal("statistic"),
  attrs: z.object({
    value: shortText(40).min(1),
    label: shortText(200).min(1),
    source: z
      .object({
        title: shortText(300).min(1),
        url: httpsUrl.optional(),
        publisher: shortText(200).optional(),
        date: z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/, "errors.content.invalid_date").optional(),
      })
      .optional(),
  }),
});

const blockSchema = z.discriminatedUnion("type", [
  paragraphSchema,
  headingSchema,
  bulletListSchema,
  orderedListSchema,
  z.object({ type: z.literal("blockquote"), content: flowContent }),
  tableSchema,
  imageSchema,
  z.object({ type: z.literal("callout"), attrs: z.object({ tone: z.enum(["info", "note", "success", "warning"]) }), content: flowContent }),
  statisticSchema,
  z.object({
    type: z.literal("quote"),
    attrs: z.object({
      text: shortText(2_000).min(1),
      attribution: shortText(200).optional(),
      role: shortText(200).optional(),
      sourceUrl: httpsUrl.optional(),
    }),
  }),
  z.object({
    type: z.literal("faqGroup"),
    content: z
      .array(z.object({ type: z.literal("faqItem"), attrs: z.object({ question: shortText(300).min(1) }), content: flowContent }))
      .min(1)
      .max(100),
  }),
  z.object({
    type: z.literal("cta"),
    attrs: z.object({ label: shortText(80).min(1), target: linkTargetSchema, variant: z.enum(["primary", "secondary"]).default("primary") }),
  }),
  z.object({ type: z.literal("entryEmbed"), attrs: z.object({ entryId: z.uuid() }) }),
  z.object({ type: z.literal("productEmbed"), attrs: z.object({ productId: z.uuid() }) }),
  z.object({
    type: z.literal("embed"),
    attrs: z.object({
      provider: z.enum(EMBED_PROVIDERS),
      id: z.string().trim().max(512),
      title: shortText(200).optional(),
      start: z.number().int().min(0).max(86_400).optional(),
    }),
  }),
]);

const docSchema = z.object({ type: z.literal("doc"), content: z.array(blockSchema).max(5_000).default([]) });

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/** Blocks that carry meaning without text (an image or embed alone is not an empty document). */
const ATOM_BLOCKS = new Set<string>(["image", "statistic", "quote", "cta", "entryEmbed", "productEmbed", "embed"]);

type AnyNode = { type: string; content?: unknown[]; attrs?: Record<string, unknown>; text?: string };

/** Visits every node depth-first with its JSON path (["content", 0, "content", 2]). */
export function walkRichDoc(doc: RichDoc, visit: (node: AnyNode, path: (string | number)[], depth: number) => void): void {
  const walk = (node: AnyNode, path: (string | number)[], depth: number) => {
    visit(node, path, depth);
    node.content?.forEach((child, i) => walk(child as AnyNode, [...path, "content", i], depth + 1));
  };
  doc.content.forEach((block, i) => walk(block as AnyNode, ["content", i], 0));
}

/** Text characters of a document, attribute text included (the per-locale size limit). */
export function richDocCharCount(doc: RichDoc): number {
  let count = 0;
  walkRichDoc(doc, (node) => {
    if (node.type === "text") count += node.text?.length ?? 0;
    const a = node.attrs;
    if (!a) return;
    for (const key of ["alt", "caption", "value", "label", "text", "attribution", "role", "question", "title"]) {
      const v = a[key];
      if (typeof v === "string") count += v.length;
    }
  });
  return count;
}

/** True when a document has no text and no media, embed or CTA. */
export function isRichDocEmpty(doc: RichDoc | null | undefined): boolean {
  if (!doc || !Array.isArray(doc.content) || doc.content.length === 0) return true;
  let empty = true;
  walkRichDoc(doc, (node) => {
    if (!empty) return;
    if (node.type === "text" && (node.text ?? "").trim().length > 0) empty = false;
    else if (ATOM_BLOCKS.has(node.type)) empty = false;
  });
  return empty;
}

// ---------------------------------------------------------------------------
// Configurable validation
// ---------------------------------------------------------------------------

export interface RichDocOptions {
  /** Block types this field allows (default: all). Inline text, hard breaks and list items are always allowed. */
  nodes?: readonly RichBlockType[] | undefined;
  /** Marks this field allows (default: all). */
  marks?: readonly RichMarkType[] | undefined;
  /** Text characters per locale (default and upper bound: CONTENT_LIMITS.richDocCharsPerLocale). */
  maxChars?: number | undefined;
  /**
   * publish: also require what a published document needs (image alt text or the decorative
   * flag, a source on every statistic). Drafts may be incomplete.
   */
  mode?: "draft" | "publish" | undefined;
}

const MAX_LIST_DEPTH = 3;

/**
 * Schema of one richDoc value, narrowed to a field's allowed nodes and marks. Nodes nested
 * inside allowed containers (lists in callouts, paragraphs in tables) count as their own type,
 * so a field without tables cannot get one inside a callout either.
 */
export function richDocSchema(options: RichDocOptions = {}): z.ZodType<RichDoc> {
  const nodes = new Set<string>(options.nodes ?? RICH_BLOCK_TYPES);
  // Structural children of allowed containers.
  nodes.add("listItem");
  nodes.add("tableRow");
  nodes.add("tableCell");
  nodes.add("tableHeader");
  nodes.add("faqItem");
  nodes.add("text");
  nodes.add("hardBreak");
  const marks = new Set<string>(options.marks ?? RICH_MARK_TYPES);
  const maxChars = Math.min(options.maxChars ?? CONTENT_LIMITS.richDocCharsPerLocale, CONTENT_LIMITS.richDocCharsPerLocale);
  const publish = options.mode === "publish";

  return docSchema.superRefine((doc, ctx) => {
    const issue = (path: (string | number)[], message: string, params?: Record<string, unknown>) =>
      ctx.addIssue({ code: "custom", path, message, ...(params ? { params } : {}) });
    walkRichDoc(doc as RichDoc, (node, path) => {
      if (!nodes.has(node.type)) issue(path, "errors.content.rich_node_not_allowed", { node: node.type });
      if (node.type === "text") {
        const nodeMarks = (node as unknown as RichTextNode).marks ?? [];
        nodeMarks.forEach((m, i) => {
          if (!marks.has(m.type)) issue([...path, "marks", i], "errors.content.rich_mark_not_allowed", { mark: m.type });
        });
      }
      if (node.type === "bulletList" || node.type === "orderedList") {
        const listDepth = path.filter((p, i) => p === "content" && i > 0).length;
        // Each list level adds two segments (list → listItem → list); the top level has none.
        if (Math.floor(listDepth / 2) >= MAX_LIST_DEPTH) issue(path, "errors.content.rich_too_deep");
      }
      if (node.type === "table") {
        const [head] = (node as unknown as RichTable).content;
        if (!head || head.content.some((c) => c.type !== "tableHeader")) issue(path, "errors.content.rich_table_header_required");
      }
      if (node.type === "embed") {
        const a = node.attrs as RichEmbed["attrs"];
        if (!isValidEmbedId(a.provider, a.id)) issue([...path, "attrs", "id"], "errors.content.invalid_embed_id", { provider: a.provider });
        if (a.start !== undefined && a.provider !== "youtube" && a.provider !== "vimeo") issue([...path, "attrs", "start"], "errors.content.embed_start_not_supported");
      }
      if (!publish) return;
      if (node.type === "image") {
        const a = node.attrs as RichImage["attrs"];
        if (!a.decorative && !a.alt?.trim()) issue([...path, "attrs", "alt"], "errors.content.image_alt_required");
      }
      if (node.type === "statistic" && !(node.attrs as RichStatistic["attrs"]).source) {
        issue([...path, "attrs", "source"], "errors.content.statistic_source_required");
      }
    });
    const chars = richDocCharCount(doc as RichDoc);
    if (chars > maxChars) issue([], "errors.content.rich_too_long", { max: maxChars, actual: chars });
  }) as unknown as z.ZodType<RichDoc>;
}
