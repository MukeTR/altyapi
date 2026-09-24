import { z } from "zod";
import { richDocSchema, type RichBlockType } from "@altyapi/content";
import { alignment, LOCALES, localized } from "./primitives";
import { CONTENT_PAGES, ENTRY_DETAIL_TEMPLATE, ENTRY_INDEX_TEMPLATE, ENTRY_TEMPLATES } from "./placements";
import { placementMatches, type SectionDefinition } from "./types";

/**
 * Content sections (docs/platform/site-turleri-ve-cms.md §5, Faz 1): the main sections of the
 * entry templates, entry lists on any page, and the richDoc versions of rich text and FAQ.
 * Entry data is resolved on the server when a page renders (render/bindings.ts).
 */

/** Rich text of a section: a richDoc per language, validated as published content (alt text, statistic sources). */
export function localizedRichDoc(options: { nodes?: readonly RichBlockType[]; maxChars: number }) {
  return z.partialRecord(z.enum(LOCALES), richDocSchema({ ...options, mode: "publish" })).default({});
}

/** A content type key (content_types.key). */
export const contentTypeKey = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "errors.section.invalid_content_type");
/** A field key of a content type. */
const fieldKey = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,47}$/, "errors.section.invalid_field");

/** Sort orders a list can ask for; "default" follows the content type's default sort. */
export const ENTRY_LIST_SORTS = ["default", "newest", "oldest", "title", "position", "updated"] as const;
export type EntryListSort = (typeof ENTRY_LIST_SORTS)[number];

/** Card layouts of entry lists. logos shows only images (partners, certificates). */
export const ENTRY_LIST_LAYOUTS = ["grid", "list", "carousel", "accordion", "table", "logos"] as const;

const FAQ_ANSWER_NODES: RichBlockType[] = ["paragraph", "bulletList", "orderedList", "table", "callout"];

export const CONTENT_SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    type: "entry-main",
    version: 1,
    name: { tr: "İçerik detayı", en: "Entry details" },
    category: "template",
    module: "content",
    policyTags: [],
    propTags: {},
    props: z.object({
      coverImage: z.boolean().default(true),
      /** Authors, reviewer and the published / last updated dates. */
      byline: z.boolean().default(true),
      /** Table of contents from the headings of the body. */
      toc: z.boolean().default(false),
      tocMinHeadings: z.number().int().min(2).max(10).default(3),
      keyFacts: z.boolean().default(true),
      faq: z.boolean().default(true),
      sources: z.boolean().default(true),
      /** Other entries of the same type, sharing a taxonomy term when the type has taxonomies. */
      related: z.boolean().default(false),
      relatedLimit: z.number().int().min(1).max(12).default(3),
      width: z.enum(["narrow", "medium", "wide"]).default("medium"),
    }),
    contentBindings: ["entry", "entries"],
    allowedIn: [ENTRY_DETAIL_TEMPLATE],
    renderer: "builtin:entry-main@1",
    singleton: true,
    requiredIn: [ENTRY_DETAIL_TEMPLATE],
  },
  {
    type: "entry-index-main",
    version: 1,
    name: { tr: "İçerik listesi sayfası", en: "Entry index" },
    category: "template",
    module: "content",
    policyTags: [],
    propTags: {},
    props: z.object({
      perPage: z.number().int().min(6).max(48).default(12),
      sort: z.enum(ENTRY_LIST_SORTS).default("default"),
      layout: z.enum(["grid", "list"]).default("grid"),
      columnsDesktop: z.number().int().min(1).max(4).default(3),
      showImage: z.boolean().default(true),
      showSummary: z.boolean().default(true),
      showDate: z.boolean().default(true),
      showReadingTime: z.boolean().default(false),
      /** Links to the archives of the type's taxonomy terms (categories, tags). */
      termFilters: z.boolean().default(true),
      /** The term's description on taxonomy archives. */
      showTermDescription: z.boolean().default(true),
    }),
    contentBindings: ["entries"],
    allowedIn: [ENTRY_INDEX_TEMPLATE],
    renderer: "builtin:entry-index-main@1",
    singleton: true,
    requiredIn: [ENTRY_INDEX_TEMPLATE],
  },
  {
    type: "entry-list",
    version: 1,
    name: { tr: "İçerik listesi", en: "Entry list" },
    category: "content",
    module: "content",
    policyTags: [],
    propTags: {},
    props: z.object({
      heading: localized(120),
      /** Content type whose live entries are listed; nothing renders until one is chosen. */
      typeKey: contentTypeKey.nullable().default(null),
      /** filter: entries matching the filters below; manual: exactly entryIds, in that order. */
      mode: z.enum(["filter", "manual"]).default("filter"),
      entryIds: z.array(z.uuid()).max(48).default([]),
      /** Only entries classified with any of these taxonomy terms. */
      termIds: z.array(z.uuid()).max(20).default([]),
      /** Only entries that reference the entry the page shows (entry detail templates). */
      referencesCurrent: z.boolean().default(false),
      /** Only entries whose date field is today or later, soonest first. */
      upcoming: z.boolean().default(false),
      /** Date field "upcoming" reads (date, datetime or date range); null = the type's first one. */
      dateField: fieldKey.nullable().default(null),
      featuredOnly: z.boolean().default(false),
      sort: z.enum(ENTRY_LIST_SORTS).default("default"),
      limit: z.number().int().min(1).max(48).default(6),
      layout: z.enum(ENTRY_LIST_LAYOUTS).default("grid"),
      columnsDesktop: z.number().int().min(1).max(6).default(3),
      showImage: z.boolean().default(true),
      showSummary: z.boolean().default(true),
      showDate: z.boolean().default(false),
      /** Link to the type's index page. */
      showViewAll: z.boolean().default(false),
    }),
    contentBindings: ["entries"],
    allowedIn: [...CONTENT_PAGES, ...ENTRY_TEMPLATES],
    renderer: "builtin:entry-list@1",
    check: (props, placement) => {
      const issues: { path: string; message: string }[] = [];
      if (props.referencesCurrent && !placementMatches(ENTRY_DETAIL_TEMPLATE, placement)) {
        issues.push({ path: "referencesCurrent", message: "errors.section.references_current_needs_entry" });
      }
      if (props.mode === "manual" && (props.upcoming || props.referencesCurrent || props.featuredOnly || (props.termIds as unknown[]).length)) {
        issues.push({ path: "mode", message: "errors.section.manual_list_has_filters" });
      }
      return issues;
    },
  },
  {
    type: "faq",
    version: 2,
    name: { tr: "Sıkça sorulan sorular", en: "FAQ" },
    category: "content",
    module: "core",
    policyTags: [],
    propTags: {},
    props: z.object({
      heading: localized(120),
      /** inline: the questions below; entries: FAQ entries of the content module, in the given order. */
      source: z.enum(["inline", "entries"]).default("inline"),
      entryIds: z.array(z.uuid()).max(50).default([]),
      emitStructuredData: z.boolean().default(true),
    }),
    blocks: { item: z.object({ question: localized(300), answer: localizedRichDoc({ nodes: FAQ_ANSWER_NODES, maxChars: 20_000 }) }) },
    maxBlocks: 50,
    contentBindings: ["entries"],
    allowedIn: [...CONTENT_PAGES, ...ENTRY_TEMPLATES],
    renderer: "builtin:faq@2",
    check: (props) => (props.source === "inline" && (props.entryIds as unknown[]).length ? [{ path: "entryIds", message: "errors.section.faq_entries_need_entries_source" }] : []),
  },
  {
    type: "rich-text",
    version: 2,
    name: { tr: "Zengin metin", en: "Rich text" },
    category: "content",
    module: "core",
    policyTags: [],
    propTags: {},
    props: z.object({
      heading: localized(160),
      body: localizedRichDoc({ maxChars: 50_000 }),
      alignment: alignment.default("left"),
      maxWidth: z.enum(["narrow", "medium", "wide"]).default("medium"),
    }),
    contentBindings: [],
    allowedIn: ["home", "product", "collection", "page", "landing", "cart", "search", "not_found", ...ENTRY_TEMPLATES],
    renderer: "builtin:rich-text@2",
  },
];
