import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import { stores } from "./tenancy";

/** Localized text: { "tr": "…", "en": "…" }. */
export type LocalizedText = Record<string, string>;

export interface SeoFields {
  title?: LocalizedText;
  description?: LocalizedText;
  imageAssetId?: string | null;
  noindex?: boolean;
  canonicalPath?: string | null;
}

export interface VisibilityRules {
  startsAt?: string | null;
  endsAt?: string | null;
  devices?: ("mobile" | "tablet" | "desktop")[];
  routes?: string[];
  excludeRoutes?: string[];
  segmentIds?: string[];
  locales?: string[];
  utm?: { source?: string[]; medium?: string[]; campaign?: string[] };
  referrerContains?: string[];
}

/** A configured section inside a page tree. Blocks are repeatable child items (slides, FAQ items…). */
export interface SectionInstance {
  id: string;
  type: string;
  version: number;
  props: Record<string, unknown>;
  settings?: {
    paddingTop?: Record<string, number>;
    paddingBottom?: Record<string, number>;
    hideOn?: ("mobile" | "tablet" | "desktop")[];
    colorScheme?: string;
    fullWidth?: boolean;
    anchorId?: string;
  };
  visibility?: VisibilityRules;
  blocks?: { id: string; type: string; props: Record<string, unknown> }[];
  disabled?: boolean;
}

export interface PageContent {
  sections: SectionInstance[];
}

export const themeStatus = pgEnum("theme_status", ["draft", "active", "archived"]);

/**
 * A store theme. The draft (tokens + global sections) is mutable; each publish freezes it
 * into an immutable theme_version.
 */
export const themes = pgTable(
  "themes",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Base theme preset (e.g. "altyapi-default"); tokens and sections are store data. */
    baseTheme: text().notNull().default("altyapi-default"),
    status: themeStatus().notNull().default("draft"),
    draftSettings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Header/footer/announcement and overlay sections rendered on every page. */
    draftGlobalSections: jsonb().$type<PageContent>().notNull().default({ sections: [] }),
    draftRevision: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [index("themes_store_idx").on(t.storeId)],
);

export const themeVersions = pgTable(
  "theme_versions",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    themeId: uuid()
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    settings: jsonb().$type<Record<string, unknown>>().notNull(),
    globalSections: jsonb().$type<PageContent>().notNull(),
    sourceRevision: integer().notNull(),
    createdByPrincipalId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("theme_versions_theme_version_uq").on(t.themeId, t.version)],
);

export const pageType = pgEnum("page_type", [
  "home",
  "product",
  "collection",
  "page",
  "landing",
  "cart",
  "search",
  "not_found",
  /** Layout for module and content routes, addressed by pages.template_key (K8). */
  "template",
]);

export const pageStatus = pgEnum("page_status", ["draft", "published", "scheduled", "unpublished"]);

export const pages = pgTable(
  "pages",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    type: pageType().notNull(),
    /**
     * URL handle for page/landing types; product/collection/… layouts use a fixed handle
     * ("default"); template pages use their template_key as handle.
     */
    handle: text().notNull(),
    /**
     * Placement a template page lays out ("entries.post.detail", "entries.post.index",
     * "services.detail", "booking.flow"); set exactly when type = 'template'.
     */
    templateKey: text(),
    title: jsonb().$type<LocalizedText>().notNull(),
    status: pageStatus().notNull().default("draft"),
    draftContent: jsonb().$type<PageContent>().notNull().default({ sections: [] }),
    draftSeo: jsonb().$type<SeoFields>().notNull().default({}),
    draftRevision: integer().notNull().default(1),
    /** Revision of the draft that was last published (draft is "dirty" when greater). */
    publishedRevision: integer(),
    publishAt: tstz(),
    unpublishAt: tstz(),
    campaignId: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pages_store_type_handle_uq").on(t.storeId, t.type, t.handle),
    index("pages_schedule_idx").on(t.publishAt).where(sql`${t.status} = 'scheduled'`),
    uniqueIndex("pages_store_template_key_uq").on(t.storeId, t.templateKey).where(sql`${t.templateKey} is not null`),
    // The enum is compared as text: 'template' was added to page_type in the same migration
    // transaction, and a new enum value cannot be used before that transaction commits.
    check("pages_template_key_type", sql`(${t.type}::text = 'template') = (${t.templateKey} is not null)`),
    check("pages_template_key_handle", sql`${t.templateKey} is null or ${t.handle} = ${t.templateKey}`),
  ],
);

export const pageVersions = pgTable(
  "page_versions",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    type: pageType().notNull(),
    handle: text().notNull(),
    title: jsonb().$type<LocalizedText>().notNull(),
    content: jsonb().$type<PageContent>().notNull(),
    seo: jsonb().$type<SeoFields>().notNull(),
    sourceRevision: integer().notNull(),
    createdByPrincipalId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("page_versions_page_version_uq").on(t.pageId, t.version)],
);

/**
 * Section definitions. store_id null = platform built-in (synced from code); store rows are
 * store-specific custom sections. props_schema is JSON Schema used by the editor.
 */
export const sectionDefinitions = pgTable(
  "section_definitions",
  {
    id: uuid().primaryKey(),
    storeId: uuid().references(() => stores.id, { onDelete: "cascade" }),
    type: text().notNull(),
    version: integer().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    category: text().notNull(),
    propsSchema: jsonb().$type<Record<string, unknown>>().notNull(),
    blockSchemas: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    defaults: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    contentBindings: jsonb().$type<string[]>().notNull().default([]),
    /** Placements: page types, "global" and template placements ("tpl:entries.{type}.detail"). */
    allowedPageTypes: jsonb().$type<string[]>().notNull().default([]),
    renderer: text().notNull(),
    /** Capability module the section belongs to (a site_modules key; core for layout and generic content). */
    module: text().notNull().default("core"),
    /** Site policy tags (K7): what the section does; rule packs block sections by tag (section.block_tag). */
    policyTags: text().array().notNull().default(sql`ARRAY[]::text[]`),
    /** Tags that apply while a prop holds a value: { "couponCode": ["discount"] }. */
    propTags: jsonb().$type<Record<string, string[]>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("section_definitions_uq").on(sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.type, t.version),
  ],
);

export interface NavigationItem {
  id: string;
  label: LocalizedText;
  /**
   * Record links resolve per language when the menu renders: entry to the entry's live path
   * (its own slug and the type's prefix in that language), entry_index to the index route of a
   * content type (/hizmetler, /en/services). A url link keeps one path for every language, so
   * it cannot follow per-language prefixes and slugs.
   */
  link:
    | { type: "url"; url: string }
    | { type: "page"; pageId: string }
    | { type: "collection"; collectionId: string }
    | { type: "product"; productId: string }
    | { type: "entry"; entryId: string }
    | { type: "entry_index"; typeId: string }
    | { type: "home" | "search" | "cart" };
  children?: NavigationItem[];
}

export const navigations = pgTable(
  "navigations",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    handle: text().notNull(),
    name: text().notNull(),
    items: jsonb().$type<NavigationItem[]>().notNull().default([]),
    revision: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("navigations_store_handle_uq").on(t.storeId, t.handle)],
);

/**
 * Immutable snapshot of everything the storefront renders. The store's live state is a
 * pointer (storefront_state.active_publication_id) switched atomically on publish/rollback.
 */
export const publications = pgTable(
  "publications",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    themeVersionId: uuid()
      .notNull()
      .references(() => themeVersions.id),
    /** pageId → pageVersionId for every live page. */
    pageVersions: jsonb().$type<Record<string, string>>().notNull(),
    navigation: jsonb().$type<Record<string, NavigationItem[]>>().notNull(),
    reason: text().notNull(),
    basedOnPublicationId: uuid(),
    createdByPrincipalId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("publications_store_number_uq").on(t.storeId, t.number)],
);

export const storefrontState = pgTable("storefront_state", {
  storeId: uuid()
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  organizationId: uuid().notNull(),
  activePublicationId: uuid().references(() => publications.id),
  activeThemeId: uuid().references(() => themes.id),
  updatedAt: tstz().notNull().defaultNow(),
});

/** exact: only from_path itself; prefix: from_path and everything below it (the rest of the path is carried over). */
export const redirectMatchType = pgEnum("redirect_match_type", ["exact", "prefix"]);

/**
 * Storefront redirects. Exact rules win over prefix rules, and the longest prefix wins among
 * prefix rules. Status 410 (Gone) answers that the path was removed on purpose; it has no
 * target.
 */
export const redirects = pgTable(
  "redirects",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    fromPath: text().notNull(),
    /** Target path or URL; null exactly when status_code is 410. */
    toPath: text(),
    statusCode: smallint().notNull().default(301),
    matchType: redirectMatchType().notNull().default("exact"),
    source: text().notNull().default("manual"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("redirects_store_from_uq").on(t.storeId, t.fromPath),
    check("redirects_status_code", sql`${t.statusCode} in (301, 302, 410)`),
    check("redirects_gone_has_no_target", sql`(${t.statusCode} = 410) = (${t.toPath} is null)`),
  ],
);

/** Previous handles of products, collections and pages; used for SEO-safe 301s. */
export const slugHistory = pgTable(
  "slug_history",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    resourceType: text().notNull(),
    resourceId: uuid().notNull(),
    locale: text().notNull(),
    slug: text().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("slug_history_uq").on(t.storeId, t.resourceType, t.locale, t.slug),
    index("slug_history_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

/**
 * Every saved draft state of a theme, page or menu. Revisions form a tree (parent pointer):
 * undo moves the draft to the parent, redo to the newest child, restore copies any revision
 * into a new one. Changes made by AI actions are recorded the same way, so they are undoable.
 */
export const draftRevisions = pgTable(
  "draft_revisions",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    resourceType: text().notNull(),
    resourceId: uuid().notNull(),
    revision: integer().notNull(),
    parentRevision: integer(),
    snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
    source: text().notNull(),
    label: text(),
    principalType: text(),
    principalId: uuid(),
    agentId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("draft_revisions_uq").on(t.resourceType, t.resourceId, t.revision),
    index("draft_revisions_parent_idx").on(t.resourceType, t.resourceId, t.parentRevision),
  ],
);
