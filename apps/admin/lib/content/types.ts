/**
 * Response shapes of the content API (/v1/…/content, packages/content). API responses may carry
 * fields that are not listed here, so code must not assume these types are exhaustive.
 */

export type LocalizedText = Record<string, string>;

/** The closed field type set of packages/content (fields/types.ts). */
export const FIELD_TYPES = [
  "text",
  "textarea",
  "richDoc",
  "slug",
  "number",
  "money",
  "boolean",
  "date",
  "datetime",
  "dateRange",
  "duration",
  "select",
  "multiSelect",
  "color",
  "asset",
  "gallery",
  "video",
  "link",
  "reference",
  "multiReference",
  "email",
  "phone",
  "address",
  "geo",
  "openingHours",
  "keyFacts",
  "sources",
  "group",
  "repeater",
  "credentials",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Field types a merchant can add to a custom type (or as extra fields of a built-in one): the
 * safe set without raw HTML, JSON, iframes or scripts, and without the built-in-only credentials.
 */
export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "richDoc",
  "number",
  "money",
  "boolean",
  "date",
  "datetime",
  "dateRange",
  "duration",
  "select",
  "multiSelect",
  "color",
  "asset",
  "gallery",
  "video",
  "link",
  "reference",
  "multiReference",
  "email",
  "phone",
  "address",
  "geo",
  "openingHours",
  "keyFacts",
  "sources",
  "group",
  "repeater",
] as const satisfies readonly FieldType[];

/** Field types that cannot be localized (their values are language-neutral). */
export const NON_LOCALIZABLE_FIELD_TYPES: readonly FieldType[] = ["select", "multiSelect", "boolean", "group", "repeater"];

export const REFERENCE_TARGET_KINDS = ["entry", "page", "product", "collection", "location"] as const;
export type ReferenceTargetKind = (typeof REFERENCE_TARGET_KINDS)[number];

export const NUMBER_UNITS = ["m2", "m", "cm", "mm", "km", "kg", "g", "l", "ml", "minute", "hour", "day", "week", "month", "year", "session", "person", "piece", "percent"] as const;

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

export type RequiredMode = false | "publish" | "always";

/** Validation settings of a field; which keys apply depends on the field type. */
export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  nodes?: RichBlockType[];
  marks?: RichMarkType[];
  maxChars?: number;
  min?: number | string;
  max?: number | string;
  integer?: boolean;
  unit?: (typeof NUMBER_UNITS)[number];
  currency?: string;
  minMinor?: number;
  maxMinor?: number;
  minMinutes?: number;
  maxMinutes?: number;
  options?: { value: string; label: LocalizedText }[];
  maxItems?: number;
  minItems?: number;
  kinds?: ("image" | "video" | "document")[];
  to?: ReferenceTargetKind;
  typeKeys?: string[];
  fields?: FieldDef[];
}

export interface FieldDef {
  key: string;
  type: FieldType;
  label: LocalizedText;
  help?: LocalizedText;
  localized: boolean;
  required: RequiredMode;
  ui: { width?: "full" | "half" | "third"; placeholder?: LocalizedText; section?: string };
  visibility: "public" | "internal";
  searchable: boolean;
  listColumn: boolean;
  filterable: boolean;
  significant: boolean;
  validation: FieldValidation;
}

/** A field of a type as the editor gets it: hidden and custom flags included. */
export interface TypeField extends FieldDef {
  hidden: boolean;
  custom: boolean;
}

export type ContentTypeKind = "collection" | "singleton" | "taxonomy";

export interface ContentTypeSettings {
  hiddenFields?: string[];
  defaultSort?: { field: "publishedAt" | "updatedAt" | "position" | "title"; direction: "asc" | "desc" };
  indexMode?: "auto" | "page" | "none";
  hierarchical?: boolean;
  maxDepth?: number;
}

export interface ContentTypeLabels {
  name: LocalizedText;
  namePlural: LocalizedText;
}

export interface ContentTypeSummary {
  id: string;
  key: string;
  builtinKey: string | null;
  builtinVersion: number | null;
  upgradeAvailable: boolean;
  kind: ContentTypeKind;
  status: "active" | "archived";
  labels: ContentTypeLabels;
  routePrefix: Record<string, string>;
  settings: ContentTypeSettings;
  routable: boolean;
  hasSlugs: boolean;
  titleField: string;
  fieldCount: number;
  taxonomies: { field: string; typeKey: string; archiveSegment: Record<string, string> }[];
  createdAt: string;
  updatedAt: string;
  /** Entries per status (list endpoint only). */
  entryCounts?: Partial<Record<EntryStatus, number>>;
}

export interface ContentTypeDetail extends ContentTypeSummary {
  fields: TypeField[];
  customFields: FieldDef[];
}

export interface BuiltinTypeInfo {
  key: string;
  version: number;
  kind: ContentTypeKind;
  labels: ContentTypeLabels;
  description: LocalizedText;
  routable: boolean;
  defaultPrefixes: Record<string, string>;
  requires: string[];
  schemaOrg: string;
  installed: { id: string; key: string; status: "active" | "archived"; upgradeAvailable: boolean } | null;
}

export type EntryStatus = "draft" | "scheduled" | "published" | "archived";
export const ENTRY_STATUSES: readonly EntryStatus[] = ["draft", "scheduled", "published", "archived"];

export interface EntryListItem {
  id: string;
  typeId: string;
  title: string;
  status: EntryStatus;
  slugs: Record<string, string>;
  publishedLocales: string[];
  hasUnpublishedChanges: boolean;
  draftRevision: number;
  parentId: string | null;
  position: number;
  publishAt: string | null;
  scheduledRevision: number | null;
  unpublishAt: string | null;
  firstPublishedAt: string | null;
  contentModifiedAt: string | null;
  updatedAt: string;
  columns: Record<string, unknown>;
}

export interface EntrySeo {
  title?: LocalizedText;
  description?: LocalizedText;
  imageAssetId?: string | null;
  noindex?: boolean;
  canonicalPath?: string | null;
}

export interface EntryRecord {
  id: string;
  typeId: string;
  parentId: string | null;
  draftData: Record<string, unknown>;
  draftSeo: EntrySeo;
  draftSlugs: Record<string, string>;
  draftRevision: number;
  publishedRevision: number | null;
  status: EntryStatus;
  liveVersionId: string | null;
  publishedLocales: string[];
  publishAt: string | null;
  scheduledRevision: number | null;
  unpublishAt: string | null;
  position: number;
  isSingleton: boolean;
  firstPublishedAt: string | null;
  contentModifiedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntryDetail {
  entry: EntryRecord;
  type: { id: string; key: string; kind: ContentTypeKind; titleField: string; hasSlugs: boolean; routable: boolean; version: number };
  schemaUpgradePending: boolean;
  title: string;
  hasUnpublishedChanges: boolean;
  live: { id: string; version: number; locales: string[]; liveFrom: string; sourceRevision: number } | null;
  versionCount: number;
  staleTranslations: { field: string; locale: string; status: "machine" | "reviewed" | "manual" }[];
}

export interface PublishResult extends EntryDetail {
  version: { id: string; version: number; locales: string[]; liveFrom: string };
  unpublishedDependencies: { id: string; typeKey: string; status: EntryStatus }[];
}

export interface EntryVersion {
  id: string;
  version: number;
  locales: string[];
  liveFrom: string;
  liveTo: string | null;
  sourceRevision: number;
  publishedByPrincipalId: string | null;
}

export interface EntryHistoryMove {
  revision: number;
  snapshot: {
    data?: Record<string, unknown>;
    seo?: EntrySeo;
    slugs?: Record<string, string>;
    parentId?: string | null;
    position?: number;
  };
}

/** A template page of a type (a storefront page of type "template"). */
export interface TypeTemplatePage {
  id: string;
  handle: string;
  templateKey: string | null;
  title: LocalizedText;
  status: string;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

export interface TypeTemplates {
  items: TypeTemplatePage[];
  /** Template keys of a routable type without a page (entries render with the built-in layout). */
  missing: string[];
}
