import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
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
import { channels, stores } from "./tenancy";
import { contentAssets } from "./storage";
import type { LocalizedText } from "./storefront";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const productKind = pgEnum("product_kind", ["physical", "digital"]);

export interface ProductAttribute {
  key: string;
  label: LocalizedText;
  value: LocalizedText;
}

export const vendors = pgTable(
  "vendors",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    handle: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("vendors_store_handle_uq").on(t.storeId, t.handle)],
);

export const taxClasses = pgTable(
  "tax_classes",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    code: text().notNull(),
    name: text().notNull(),
    /** Rate in basis points (KDV %20 = 2000). */
    rateBps: integer().notNull(),
    /** Whether catalog prices include this tax (Turkey: KDV-inclusive retail prices). */
    pricesIncludeTax: boolean().notNull().default(true),
    isDefault: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("tax_classes_store_code_uq").on(t.storeId, t.code)],
);

export const products = pgTable(
  "products",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    status: productStatus().notNull().default("draft"),
    kind: productKind().notNull().default("physical"),
    vendorId: uuid().references(() => vendors.id, { onDelete: "set null" }),
    categoryId: uuid(),
    taxClassId: uuid().references(() => taxClasses.id, { onDelete: "set null" }),
    productType: text(),
    weightGrams: integer(),
    lengthMm: integer(),
    widthMm: integer(),
    heightMm: integer(),
    attributes: jsonb().$type<ProductAttribute[]>().notNull().default([]),
    /** Scheduled publish: status flips to active at this time (worker). */
    publishAt: tstz(),
    publishedAt: tstz(),
    searchDocument: tsvector(),
    /** External id from imports / integrations for idempotent upserts. */
    externalRef: text(),
    ...timestamps,
  },
  (t) => [
    index("products_store_status_idx").on(t.storeId, t.status, t.updatedAt),
    uniqueIndex("products_store_external_uq").on(t.storeId, t.externalRef).where(sql`${t.externalRef} is not null`),
    index("products_search_idx").using("gin", t.searchDocument),
    index("products_schedule_idx").on(t.publishAt).where(sql`${t.publishAt} is not null`),
  ],
);

export const productTranslations = pgTable(
  "product_translations",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    locale: text().notNull(),
    title: text().notNull(),
    handle: text().notNull(),
    descriptionHtml: text().notNull().default(""),
    seoTitle: text(),
    seoDescription: text(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locale] }),
    uniqueIndex("product_translations_handle_uq").on(t.storeId, t.locale, t.handle),
  ],
);

export const productOptions = pgTable(
  "product_options",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
  },
  (t) => [index("product_options_product_idx").on(t.productId)],
);

export const productOptionValues = pgTable(
  "product_option_values",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    optionId: uuid()
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    value: jsonb().$type<LocalizedText>().notNull(),
    /** Optional swatch (hex color or asset) for the variant picker. */
    swatchColor: text(),
    swatchAssetId: uuid(),
  },
  (t) => [index("product_option_values_option_idx").on(t.optionId)],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    sku: text(),
    barcode: text(),
    /** Sorted option value ids; unique per product so each combination exists once. */
    optionValueIds: uuid().array().notNull().default(sql`ARRAY[]::uuid[]`),
    weightGrams: integer(),
    requiresShipping: boolean().notNull().default(true),
    trackInventory: boolean().notNull().default(true),
    allowBackorder: boolean().notNull().default(false),
    taxClassId: uuid().references(() => taxClasses.id, { onDelete: "set null" }),
    /** Deliverable file for digital products (merchant-private bucket). */
    digitalAssetId: uuid().references(() => contentAssets.id, { onDelete: "set null" }),
    externalRef: text(),
    archivedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    index("product_variants_product_idx").on(t.productId),
    uniqueIndex("product_variants_sku_uq").on(t.storeId, t.sku).where(sql`${t.sku} is not null and ${t.archivedAt} is null`),
    uniqueIndex("product_variants_options_uq").on(t.productId, t.optionValueIds).where(sql`${t.archivedAt} is null`),
    index("product_variants_barcode_idx").on(t.storeId, t.barcode),
  ],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    assetId: uuid()
      .notNull()
      .references(() => contentAssets.id, { onDelete: "restrict" }),
    position: integer().notNull(),
    alt: jsonb().$type<LocalizedText>().notNull().default({}),
    /** Variants this image represents (for switching gallery on variant selection). */
    variantIds: uuid().array().notNull().default(sql`ARRAY[]::uuid[]`),
  },
  (t) => [index("product_media_product_idx").on(t.productId, t.position)],
);

/** Hierarchical taxonomy (breadcrumbs, Google product category mapping). */
export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    parentId: uuid(),
    position: integer().notNull().default(0),
    name: jsonb().$type<LocalizedText>().notNull(),
    handle: text().notNull(),
    googleCategoryId: integer(),
    ...timestamps,
  },
  (t) => [uniqueIndex("categories_store_handle_uq").on(t.storeId, t.handle), index("categories_parent_idx").on(t.storeId, t.parentId)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
  },
  (t) => [uniqueIndex("tags_store_name_uq").on(t.storeId, sql`lower(${t.name})`)],
);

export const productTags = pgTable(
  "product_tags",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tagId] }), index("product_tags_tag_idx").on(t.tagId)],
);

export const collectionType = pgEnum("collection_type", ["manual", "automated"]);
export const collectionSort = pgEnum("collection_sort", [
  "manual",
  "best_selling",
  "newest",
  "price_asc",
  "price_desc",
  "title_asc",
  "title_desc",
]);

export const collections = pgTable(
  "collections",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    type: collectionType().notNull(),
    sortOrder: collectionSort().notNull().default("manual"),
    /** For automated collections: all rules must match (true) or any rule (false). */
    matchAll: boolean().notNull().default(true),
    imageAssetId: uuid().references(() => contentAssets.id, { onDelete: "set null" }),
    isPublished: boolean().notNull().default(false),
    publishedAt: tstz(),
    ...timestamps,
  },
  (t) => [index("collections_store_idx").on(t.storeId)],
);

export const collectionTranslations = pgTable(
  "collection_translations",
  {
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    locale: text().notNull(),
    title: text().notNull(),
    handle: text().notNull(),
    descriptionHtml: text().notNull().default(""),
    seoTitle: text(),
    seoDescription: text(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.locale] }),
    uniqueIndex("collection_translations_handle_uq").on(t.storeId, t.locale, t.handle),
  ],
);

export const collectionRuleField = pgEnum("collection_rule_field", [
  "tag",
  "vendor",
  "category",
  "product_type",
  "title",
  "price",
  "compare_at_price",
  "inventory",
  "attribute",
  "created_at",
]);

export const collectionRuleOperator = pgEnum("collection_rule_operator", [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "greater_than",
  "less_than",
  "in",
]);

export const collectionRules = pgTable(
  "collection_rules",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid().notNull(),
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    field: collectionRuleField().notNull(),
    operator: collectionRuleOperator().notNull(),
    /** Attribute key when field = attribute. */
    attributeKey: text(),
    value: text().notNull(),
  },
  (t) => [index("collection_rules_collection_idx").on(t.collectionId)],
);

/** Membership. Manual collections are edited directly; automated ones are materialized by the worker. */
export const productCollections = pgTable(
  "product_collections",
  {
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    position: integer().notNull().default(0),
    addedAt: tstz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] }), index("product_collections_product_idx").on(t.productId)],
);

/** Per-channel visibility of a product. */
export const channelListings = pgTable(
  "channel_listings",
  {
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    channelId: uuid()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    isVisible: boolean().notNull().default(true),
    availableForPurchase: boolean().notNull().default(true),
    publishedAt: tstz(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.channelId] }), index("channel_listings_channel_idx").on(t.channelId)],
);

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export const importFormat = pgEnum("import_format", ["csv", "xlsx", "xml"]);
export const importStatus = pgEnum("import_status", [
  "uploaded",
  "analyzing",
  "awaiting_mapping",
  "previewing",
  "ready",
  "processing",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
]);

/** Target field → source column (or XML path) mapping. */
export type ImportMapping = Record<string, string>;

export interface ImportOptions {
  /** XML: path to the repeating product/variant element, e.g. "Urunler.Urun". */
  xmlItemPath?: string;
  csvDelimiter?: string;
  locale?: string;
  currency?: string;
  /** How rows are matched to existing records. */
  matchBy?: "sku" | "external_ref" | "handle";
  /** Rows with the same group key become variants of one product. */
  groupBy?: "handle" | "external_ref" | "none";
  updateExisting?: boolean;
  publishImported?: boolean;
}

export const importProfiles = pgTable(
  "import_profiles",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    format: importFormat().notNull(),
    mapping: jsonb().$type<ImportMapping>().notNull(),
    options: jsonb().$type<ImportOptions>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("import_profiles_store_name_uq").on(t.storeId, t.name)],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid().primaryKey(),
    organizationId: uuid().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    assetId: uuid()
      .notNull()
      .references(() => contentAssets.id, { onDelete: "restrict" }),
    profileId: uuid().references(() => importProfiles.id, { onDelete: "set null" }),
    format: importFormat().notNull(),
    status: importStatus().notNull().default("uploaded"),
    mapping: jsonb().$type<ImportMapping>(),
    options: jsonb().$type<ImportOptions>().notNull().default({}),
    detectedColumns: jsonb().$type<string[]>(),
    sampleRows: jsonb().$type<Record<string, string>[]>(),
    preview: jsonb().$type<Record<string, unknown>[]>(),
    totalRows: integer(),
    processedRows: integer().notNull().default(0),
    createdCount: integer().notNull().default(0),
    updatedCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    /** Chunk checkpoint so a restarted job resumes instead of starting over. */
    lastProcessedRow: integer().notNull().default(0),
    /** Last group key fully processed in pass 2 (groups are processed in key order). */
    lastProcessedGroup: text(),
    stagedAt: tstz(),
    errorReportAssetId: uuid(),
    failureReason: text(),
    requestedByPrincipalId: uuid(),
    startedAt: tstz(),
    finishedAt: tstz(),
    ...timestamps,
  },
  (t) => [index("import_jobs_store_idx").on(t.storeId, t.createdAt)],
);

export const importRowErrors = pgTable(
  "import_row_errors",
  {
    id: uuid().primaryKey(),
    jobId: uuid()
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    rowNumber: integer().notNull(),
    errors: jsonb().$type<{ field: string; message: string }[]>().notNull(),
    raw: jsonb().$type<Record<string, string>>().notNull(),
  },
  (t) => [index("import_row_errors_job_idx").on(t.jobId, t.rowNumber)],
);

/**
 * Staging rows of an import. Pass 1 streams the file into this table; pass 2 processes
 * groups (one product each) in order, checkpointing so a restarted job resumes.
 */
export const importRows = pgTable(
  "import_rows",
  {
    jobId: uuid()
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowNumber: integer().notNull(),
    storeId: uuid().notNull(),
    organizationId: uuid().notNull(),
    groupKey: text().notNull(),
    data: jsonb().$type<Record<string, string>>().notNull(),
    processed: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.rowNumber] }), index("import_rows_group_idx").on(t.jobId, t.groupKey, t.rowNumber)],
);
