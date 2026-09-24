import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps, tstz } from "./_shared";
import type { LocalizedText, SeoFields } from "./storefront";
import { stores } from "./tenancy";

/**
 * Content core (docs/platform/site-turleri-ve-cms.md §3, K1, K2, K13). Built-in content types
 * are defined in code (@altyapi/content); a content_types row installs one for a store and
 * holds only the store-specific part. Entries keep a mutable draft; each publish freezes an
 * immutable record_versions row that the entry points at (live_version_id), so "what was live
 * at time T" can always be answered. Live slugs and their history live in record_slugs.
 */

/** collection: many entries, optionally routable; singleton: one entry per site; taxonomy: terms with slug, description and SEO. */
export const contentTypeKind = pgEnum("content_type_kind", ["collection", "singleton", "taxonomy"]);

export const contentTypeStatus = pgEnum("content_type_status", ["active", "archived"]);

/**
 * draft: never published or taken down; scheduled: not live, goes live at publish_at;
 * published: live_version_id is set (a live entry can also carry a scheduled update in
 * publish_at and a scheduled take-down in unpublish_at); archived: hidden from lists, not live.
 */
export const contentEntryStatus = pgEnum("content_entry_status", ["draft", "scheduled", "published", "archived"]);

/** Which state of the source a reference row describes: the current draft or the live version. */
export const contentReferenceState = pgEnum("content_reference_state", ["draft", "live"]);

export const contentReferenceTarget = pgEnum("content_reference_target", ["entry", "page", "product", "collection", "asset", "location"]);

export interface ContentTypeLabels {
  name: LocalizedText;
  namePlural: LocalizedText;
}

export interface ContentTypeSettings {
  /** Optional built-in fields this site hides from the editor, the storefront and the APIs. */
  hiddenFields?: string[];
  defaultSort?: { field: string; direction: "asc" | "desc" };
  /**
   * auto: the index route renders the type's index template; page: a merchant-designed page
   * serves as the index; none: the type has no index route (entries may still be routable).
   */
  indexMode?: "auto" | "page" | "none";
  /** Entries may have a parent entry of the same type. */
  hierarchical?: boolean;
  /** Maximum nesting depth when hierarchical (1 = top-level entries only). */
  maxDepth?: number;
}

/**
 * A content type installed on a store: a built-in type (builtin_key + builtin_version, schema
 * in code) or a custom type described only by custom_fields. key is the immutable handle used
 * in APIs, templates (entries.<key>.detail) and references.
 */
export const contentTypes = pgTable(
  "content_types",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    key: text().notNull(),
    /** Code definition this type installs ("post", "service", …); null for a custom type. */
    builtinKey: text(),
    /** Version of the code definition the stored entries were last migrated to. */
    builtinVersion: integer(),
    kind: contentTypeKind().notNull(),
    labels: jsonb().$type<ContentTypeLabels>().notNull(),
    /**
     * locale → URL prefix, path segments without leading or trailing slash ({ tr: "hizmetler",
     * en: "services" }). Empty = entries of this type have no URL of their own.
     */
    routePrefix: jsonb().$type<Record<string, string>>().notNull().default({}),
    settings: jsonb().$type<ContentTypeSettings>().notNull().default({}),
    /** FieldDef[] of @altyapi/content: extra fields of a built-in type, or all fields of a custom type. Parse before use. */
    customFields: jsonb().$type<unknown[]>().notNull().default([]),
    status: contentTypeStatus().notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("content_types_store_key_uq").on(t.storeId, t.key),
    check("content_types_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,47}$'`),
    check("content_types_builtin_pair", sql`(${t.builtinKey} is null) = (${t.builtinVersion} is null)`),
  ],
);

/** Per field path and locale: the translation's source hash and how it was produced. */
export type ContentTranslationState = Record<string, Record<string, { sourceHash: string; status: "machine" | "reviewed" | "manual" }>>;

/**
 * Content entries. Columns prefixed draft_ (plus parent_id and position) are the editable
 * draft; what is live is the record_versions row live_version_id points at. draft_revision
 * guards concurrent edits (expectedRevision) and keys the draft_revisions history
 * (resource type "entry").
 */
export const contentEntries = pgTable(
  "content_entries",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    typeId: uuid()
      .notNull()
      .references(() => contentTypes.id),
    /** Parent entry of the same type (hierarchical types). */
    parentId: uuid().references((): AnyPgColumn => contentEntries.id),
    /** Field values keyed by field key; localized fields hold { locale: value } maps. */
    draftData: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    draftSeo: jsonb().$type<SeoFields>().notNull().default({}),
    /** locale → URL slug the next publish makes current (record_slugs holds the live ones). */
    draftSlugs: jsonb().$type<Record<string, string>>().notNull().default({}),
    draftRevision: integer().notNull().default(1),
    /** Draft revision the live version was published from (the draft has changes when greater). */
    publishedRevision: integer(),
    /** Version of the type schema draft_data was written against (built-in version or custom field revision). */
    schemaVersion: integer().notNull().default(1),
    status: contentEntryStatus().notNull().default("draft"),
    liveVersionId: uuid().references((): AnyPgColumn => recordVersions.id),
    /** Locales the live version is published in (required fields filled at publish time). */
    publishedLocales: text().array().notNull().default(sql`ARRAY[]::text[]`),
    translationState: jsonb().$type<ContentTranslationState>().notNull().default({}),
    /** When the draft is published by the scheduler (status scheduled, or a scheduled update of a live entry). */
    publishAt: tstz(),
    /**
     * Draft revision the scheduled publish puts live: the revision a principal with
     * content:publish approved when scheduling (or saved since). Later edits by others stay in
     * the draft; the scheduler publishes this revision's snapshot. Set exactly when publish_at is.
     */
    scheduledRevision: integer(),
    /** Who approved the scheduled publish; recorded as the publisher of the version it creates. */
    scheduledByPrincipalId: uuid(),
    /** When the live version is taken down by the scheduler. */
    unpublishAt: tstz(),
    position: integer().notNull().default(0),
    /**
     * Entry of a singleton type (copied from the type's kind on insert; a type's kind never
     * changes). A partial unique index allows one non-archived entry per singleton type.
     */
    isSingleton: boolean().notNull().default(false),
    /** First time the entry went live (datePublished). */
    firstPublishedAt: tstz(),
    /** Last publish that changed the published content (dateModified, sitemap lastmod). */
    contentModifiedAt: tstz(),
    createdByPrincipalId: uuid(),
    updatedByPrincipalId: uuid(),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    index("content_entries_type_status_idx").on(t.storeId, t.typeId, t.status),
    index("content_entries_parent_idx").on(t.parentId, t.position).where(sql`${t.parentId} is not null`),
    index("content_entries_store_schedule_idx").on(t.storeId, t.publishAt).where(sql`${t.publishAt} is not null`),
    index("content_entries_publish_due_idx").on(t.publishAt).where(sql`${t.publishAt} is not null`),
    index("content_entries_unpublish_due_idx").on(t.unpublishAt).where(sql`${t.unpublishAt} is not null`),
    uniqueIndex("content_entries_singleton_uq").on(t.typeId).where(sql`${t.isSingleton} and ${t.status} <> 'archived'`),
    check("content_entries_live_consistency", sql`(${t.status} = 'published') = (${t.liveVersionId} is not null)`),
    check("content_entries_scheduled_has_time", sql`${t.status} <> 'scheduled' or ${t.publishAt} is not null`),
    check("content_entries_schedule_pinned", sql`(${t.publishAt} is null) = (${t.scheduledRevision} is null)`),
    check("content_entries_archived_consistency", sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`),
    check("content_entries_not_own_parent", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

/** record_versions.data of a content entry: everything the storefront renders for it. */
export interface ContentEntryVersionData {
  typeId: string;
  schemaVersion: number;
  data: Record<string, unknown>;
  seo: SeoFields;
  /** locale → slug live with this version. */
  slugs: Record<string, string>;
  parentId: string | null;
  position: number;
}

/**
 * Immutable published versions of records (K1): content entries now; people, locations and
 * listings later. A database trigger rejects every change except closing the version
 * (live_to set once, from null) and every delete except the cascade of a store deletion.
 * At most one version per record is open (live_to null) at a time.
 */
export const recordVersions = pgTable(
  "record_versions",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** content_entry (later person, location, listing). */
    resourceType: text().notNull(),
    resourceId: uuid().notNull(),
    /** 1, 2, … per record. */
    version: integer().notNull(),
    /** Full published snapshot (ContentEntryVersionData for content entries). */
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    /**
     * locale → output derived at publish time: html, markdown, plain, outline, qa, wordCount,
     * readingMinutes, refs (produced by @altyapi/content).
     */
    derived: jsonb().$type<Record<string, Record<string, unknown>>>().notNull().default({}),
    locales: text().array().notNull().default(sql`ARRAY[]::text[]`),
    liveFrom: tstz().notNull().defaultNow(),
    /** When the version stopped being live (replaced or taken down); null while live. */
    liveTo: tstz(),
    /** Draft revision the version was published from, when the record keeps draft revisions. */
    sourceRevision: integer(),
    publishedByPrincipalId: uuid(),
    /** Compliance policy snapshot and lint report the publish was checked against (later phases). */
    policySnapshotId: uuid(),
    lintReportId: uuid(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("record_versions_resource_version_uq").on(t.resourceType, t.resourceId, t.version),
    uniqueIndex("record_versions_open_uq").on(t.resourceType, t.resourceId).where(sql`${t.liveTo} is null`),
    index("record_versions_store_timeline_idx").on(t.storeId, t.liveFrom),
    check("record_versions_version_positive", sql`${t.version} >= 1`),
    check("record_versions_live_period", sql`${t.liveTo} is null or ${t.liveTo} >= ${t.liveFrom}`),
  ],
);

/**
 * URL slugs of records per locale (K2). The current slug of a record is unique within its
 * scope (e.g. the content type id); old slugs stay as history so requests for them can be
 * answered with a 301 to the current URL.
 */
export const recordSlugs = pgTable(
  "record_slugs",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    resourceType: text().notNull(),
    resourceId: uuid().notNull(),
    /** Uniqueness scope of the slug, e.g. the content type id. */
    scopeKey: text().notNull(),
    locale: text().notNull(),
    slug: text().notNull(),
    isCurrent: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("record_slugs_current_uq").on(t.storeId, t.scopeKey, t.locale, t.slug).where(sql`${t.isCurrent}`),
    uniqueIndex("record_slugs_resource_current_uq").on(t.resourceType, t.resourceId, t.locale).where(sql`${t.isCurrent}`),
    uniqueIndex("record_slugs_resource_slug_uq").on(t.resourceType, t.resourceId, t.locale, t.slug),
    index("record_slugs_lookup_idx").on(t.storeId, t.scopeKey, t.locale, t.slug),
  ],
);

/**
 * What records point at (entries, pages, products, collections, assets, locations). Each save
 * rewrites the source's draft rows, each publish its live rows (the setAssetReferences
 * pattern). Used for reverse lists, "used in", delete protection, publish dependency checks,
 * internal link resolution and cache purge targets.
 */
export const contentReferences = pgTable(
  "content_references",
  {
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** content_entry, page, … */
    sourceType: text().notNull(),
    sourceId: uuid().notNull(),
    state: contentReferenceState().notNull(),
    targetKind: contentReferenceTarget().notNull(),
    targetId: uuid().notNull(),
    /** Where in the source the reference sits ("data.body.tr", "data.relatedServices"). */
    fieldPath: text().notNull(),
  },
  (t) => [
    primaryKey({ name: "content_references_pk", columns: [t.sourceType, t.sourceId, t.state, t.targetKind, t.targetId, t.fieldPath] }),
    index("content_references_target_idx").on(t.storeId, t.targetKind, t.targetId),
  ],
);
