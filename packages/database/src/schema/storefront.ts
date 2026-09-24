import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** URL handle for page/landing types; template types use a fixed handle ("default"). */
    handle: text().notNull(),
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
    allowedPageTypes: jsonb().$type<string[]>().notNull().default([]),
    renderer: text().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("section_definitions_uq").on(sql`coalesce(${t.storeId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.type, t.version),
  ],
);

export interface NavigationItem {
  id: string;
  label: LocalizedText;
  link:
    | { type: "url"; url: string }
    | { type: "page"; pageId: string }
    | { type: "collection"; collectionId: string }
    | { type: "product"; productId: string }
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

export const redirects = pgTable(
  "redirects",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    fromPath: text().notNull(),
    toPath: text().notNull(),
    statusCode: smallint().notNull().default(301),
    source: text().notNull().default("manual"),
    ...timestamps,
  },
  (t) => [uniqueIndex("redirects_store_from_uq").on(t.storeId, t.fromPath)],
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
